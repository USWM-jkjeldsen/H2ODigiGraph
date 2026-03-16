import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Animated,
  Alert,
  Modal,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import {
  GraphCanvas,
  type CanvasMode,
  type CalibrationPointKey,
} from '../../src/components/GraphCanvas';
import { BoundaryEditor, type BoundaryValues } from '../../src/components/BoundaryEditor';
import { getSessions, saveSession } from '../../src/lib/storage';
import { interpolateDailyValues, pixelToReal } from '../../src/lib/digitizer';
import type { DigiSession, DigiPoint } from '../../src/lib/types';
import { Colors, Spacing, FontSize } from '../../src/lib/theme';
import { cropImageFromCanvasBox } from '../../src/lib/imageCrop';
import { traceGraphLineNormalized } from '../../src/lib/autoTrace';
import { detectGraphPaperScale } from '../../src/lib/gridScale';

const MIN_REFINE_BOX_PX = 10;
const FALLBACK_DAY_SPAN = 1;
const FALLBACK_STAGE_SPAN_FT = 1;
const DAY_MS = 86_400_000;
const FULL_TRACE_OPTIONS = {
  xSamples: 520,
  thresholdBoost: 24,
  lightTolerance: 40,
  continuityWeight: 0.36,
  contrastWeight: 0.96,
  smoothingRadius: 1,
  saturationWeight: 0.72,
  searchRadiusNorm: 0.17,
} as const;

export default function DigitizeScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();
  const [session, setSession] = useState<DigiSession | null>(null);
  const [mode, setMode] = useState<CanvasMode>('idle');
  const [pendingBoxStart, setPendingBoxStart] = useState<{ x: number; y: number } | null>(null);
  const [pendingBoxEnd, setPendingBoxEnd] = useState<{ x: number; y: number } | null>(null);
  const pendingRefineStart = useRef<{ x: number; y: number } | null>(null);
  const pendingRefineEnd = useRef<{ x: number; y: number } | null>(null);
  const [boxSelectionMode, setBoxSelectionMode] = useState<'bounds' | 'refine' | null>(null);
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number } | null>(null);
  const [imageFrame, setImageFrame] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [showBoundsForm, setShowBoundsForm] = useState(false);
  const [showPointsModal, setShowPointsModal] = useState(false);
  const [lastDetectedDebug, setLastDetectedDebug] = useState<string | null>(null);
  const [autoTracing, setAutoTracing] = useState(false);
  const [preTraceSnapshot, setPreTraceSnapshot] = useState<DigiPoint[] | null>(null);
  const [advancedCalibrationEnabled, setAdvancedCalibrationEnabled] = useState(false);
  const [calibrationPoints, setCalibrationPoints] = useState<
    Partial<Record<CalibrationPointKey, { x: number; y: number }>>
  >({});
  const sheetAnim = useRef(new Animated.Value(0)).current;

  const SHEET_HEIGHT = 580;

  const openSheet = () => {
    setShowBoundsForm(true);
    Animated.spring(sheetAnim, { toValue: 1, useNativeDriver: true, tension: 65, friction: 11 }).start();
  };

  const closeSheet = () => {
    Animated.timing(sheetAnim, { toValue: 0, duration: 220, useNativeDriver: true }).start(() =>
      setShowBoundsForm(false),
    );
  };

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const sessions = await getSessions();
        const found = sessions.find((s) => s.id === sessionId) ?? null;
        setSession(found);
      })();
    }, [sessionId]),
  );

  const updateSession = async (updates: Partial<DigiSession>) => {
    if (!session) return;
    const updated = { ...session, ...updates };
    setSession(updated);
    await saveSession(updated);
  };

  const resolveFrame = useCallback(() => {
    if (imageFrame) return imageFrame;
    if (!session?.bounds) return null;
    return {
      x: Math.min(session.bounds.originPx.x, session.bounds.farPx.x),
      y: Math.min(session.bounds.originPx.y, session.bounds.farPx.y),
      width: Math.abs(session.bounds.farPx.x - session.bounds.originPx.x),
      height: Math.abs(session.bounds.originPx.y - session.bounds.farPx.y),
    };
  }, [imageFrame, session?.bounds]);

  const runLocalRefineTrace = useCallback(async (startPx: { x: number; y: number }, endPx: { x: number; y: number }) => {
    if (!session?.bounds) return;
    const sourceUri = session.croppedImageUri ?? session.imageUri;
    if (!sourceUri) return;

    const frame = resolveFrame();
    if (!frame || frame.width < 2 || frame.height < 2) {
      Alert.alert('Frame not ready', 'Please wait a moment and retry Refine Box.');
      return;
    }

    const left = Math.max(frame.x, Math.min(startPx.x, endPx.x));
    const right = Math.min(frame.x + frame.width, Math.max(startPx.x, endPx.x));
    const top = Math.max(frame.y, Math.min(startPx.y, endPx.y));
    const bottom = Math.min(frame.y + frame.height, Math.max(startPx.y, endPx.y));
    if (right - left < MIN_REFINE_BOX_PX || bottom - top < MIN_REFINE_BOX_PX) {
      Alert.alert('Refine box too small', 'Drag a slightly larger box over the section to retrace.');
      return;
    }

    const clampNorm = (v: number) => Math.max(0, Math.min(1, v));
    const xNormStart = clampNorm((left - frame.x) / frame.width);
    const xNormEnd = clampNorm((right - frame.x) / frame.width);
    const yNormHint = clampNorm(((top + bottom) * 0.5 - frame.y) / frame.height);
    const yNormBand = Math.max(0.05, Math.min(0.48, ((bottom - top) / frame.height) * 0.5 + 0.03));

    setAutoTracing(true);
    try {
      const segment = await traceGraphLineNormalized(sourceUri, {
        ...FULL_TRACE_OPTIONS,
        xNormStart,
        xNormEnd,
        yNormHint,
        yNormBand,
      });

      if (segment.length < 3) {
        Alert.alert('Refine box failed', 'Could not retrace this section. Try a taller box around the line.');
        return;
      }

      const tracedSegment: DigiPoint[] = segment.map((p) => {
        const px = {
          x: frame.x + p.x * frame.width,
          y: frame.y + p.y * frame.height,
        };
        const real = pixelToReal(px, session.bounds!, { width: 1, height: 1 });
        return { px, realX: real.realX, realY: real.realY };
      });

      const existing = session.points ?? [];
      const keep = existing.filter((p) => p.px.x < left || p.px.x > right);
      const merged = [...keep, ...tracedSegment].sort((a, b) => a.px.x - b.px.x);

      setPreTraceSnapshot(existing);
      await updateSession({
        points: merged,
        extractedLinePx: buildExtractedLine(merged),
        status: 'digitized',
      });
      Alert.alert('Refine complete', `Updated ${tracedSegment.length} points in selected section.`);
    } catch (err) {
      console.warn('Refine box trace failed', err);
      Alert.alert('Refine failed', 'Could not refine this section. Try a slightly larger box.');
    } finally {
      setAutoTracing(false);
    }
  }, [buildExtractedLine, resolveFrame, session, updateSession]);

  // Step 1: bottom-left corner, Step 2: top-right corner
  const handleBoxStartSet = (px: { x: number; y: number }) => {
    if (boxSelectionMode === 'refine') {
      pendingRefineStart.current = px;
      pendingRefineEnd.current = null;
      setMode('setBoxEnd');
      return;
    }
    setPendingBoxStart(px);
    setMode('setBoxEnd');
  };

  const handleBoxEndSet = async (px: { x: number; y: number }) => {
    if (boxSelectionMode === 'refine') {
      const start = pendingRefineStart.current ?? px;
      pendingRefineEnd.current = px;
      await runLocalRefineTrace(start, px);
      pendingRefineStart.current = null;
      pendingRefineEnd.current = null;
      setBoxSelectionMode(null);
      setMode('digitize');
      return;
    }
    setPendingBoxEnd(px);
    setMode('idle');
    openSheet();
  };

  const beginAdvancedCalibrationSelection = () => {
    const frame = resolveFrame();
    if (!frame || frame.width < 2 || frame.height < 2) {
      Alert.alert(
        'Frame not ready',
        'Please wait for the chart to finish rendering, then try Advanced Calibration again.',
      );
      return;
    }

    setAdvancedCalibrationEnabled(true);
    setBoxSelectionMode(null);
    pendingRefineStart.current = null;
    pendingRefineEnd.current = null;
    closeSheet();
    setMode('setCalXStart');
    Alert.alert(
      'Advanced Calibration',
      'Tap the chart point that matches your known X start time.',
    );
  };

  const handleCalibrationPointSet = (key: CalibrationPointKey, px: { x: number; y: number }) => {
    const frame = resolveFrame();
    if (
      !frame ||
      px.x < frame.x ||
      px.x > frame.x + frame.width ||
      px.y < frame.y ||
      px.y > frame.y + frame.height
    ) {
      Alert.alert(
        'Tap inside chart',
        'Reference points must be tapped inside the active chart area.',
      );
      return;
    }

    setCalibrationPoints((prev) => ({ ...prev, [key]: px }));

    if (key === 'xStart') {
      setMode('setCalXEnd');
      Alert.alert(
        'Advanced Calibration',
        'Now tap the chart point that matches your known X end time.',
      );
      return;
    }

    if (key === 'xEnd') {
      setMode('setCalYRef');
      Alert.alert(
        'Advanced Calibration',
        'Now tap a chart point where you know the exact stage value.',
      );
      return;
    }

    setMode('idle');
    openSheet();
    Alert.alert('Advanced Calibration', 'Reference points captured. Enter the known values and apply.');
  };

  const toIsoDate = (dateLike: string) => {
    const parsed = new Date(dateLike.replace(' ', 'T'));
    return Number.isNaN(parsed.getTime()) ? new Date(dateLike) : parsed;
  };

  const formatPointTimestamp = (point: DigiPoint) => {
    if (!session?.bounds) return null;

    const startMs = new Date(session.bounds.startDate).getTime();
    const endMs = new Date(session.bounds.endDate).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;

    const spanMs = endMs - startMs;
    const xSpan = session.bounds.xMax - session.bounds.xMin;
    if (!Number.isFinite(spanMs) || !Number.isFinite(xSpan) || xSpan === 0) return null;

    const norm = (point.realX - session.bounds.xMin) / xSpan;
    const timestamp = new Date(startMs + norm * spanMs);
    if (Number.isNaN(timestamp.getTime())) return null;

    return timestamp.toLocaleString([], {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const sortedPoints = (session?.points ?? []).slice().sort((a, b) => a.realX - b.realX);

  function buildExtractedLine(inputPoints: DigiPoint[]): { x: number; y: number }[] {
    if (inputPoints.length < 3) {
      return inputPoints.map((p) => p.px);
    }

    const sorted = [...inputPoints].sort((a, b) => a.px.x - b.px.x);
    return sorted.map((p, i, arr) => {
      const prev = arr[Math.max(0, i - 1)].px;
      const next = arr[Math.min(arr.length - 1, i + 1)].px;
      const y = (prev.y + p.px.y + next.y) / 3;
      return { x: p.px.x, y };
    });
  }

  useEffect(() => {
    if (!session?.croppedImageUri || !session.bounds || !imageFrame) return;

    const nextOrigin = { x: imageFrame.x, y: imageFrame.y + imageFrame.height };
    const nextFar = { x: imageFrame.x + imageFrame.width, y: imageFrame.y };
    const currentOrigin = session.bounds.originPx;
    const currentFar = session.bounds.farPx;
    const isClose =
      Math.abs(currentOrigin.x - nextOrigin.x) < 1 &&
      Math.abs(currentOrigin.y - nextOrigin.y) < 1 &&
      Math.abs(currentFar.x - nextFar.x) < 1 &&
      Math.abs(currentFar.y - nextFar.y) < 1;

    if (isClose) return;

    const updated: DigiSession = {
      ...session,
      bounds: {
        ...session.bounds,
        originPx: nextOrigin,
        farPx: nextFar,
      },
    };
    setSession(updated);
    void saveSession(updated);
  }, [imageFrame, session]);

  // User submits start time + start stage; box tap corners define plotted area.
  const handleBoundsSave = async (values: BoundaryValues) => {
    const hasFreshBoxSelection = Boolean(pendingBoxStart && pendingBoxEnd);
    const startCorner = hasFreshBoxSelection
      ? pendingBoxStart
      : session?.bounds
        ? { x: session.bounds.originPx.x, y: session.bounds.originPx.y }
        : null;
    const endCorner = hasFreshBoxSelection
      ? pendingBoxEnd
      : session?.bounds
        ? { x: session.bounds.farPx.x, y: session.bounds.farPx.y }
        : null;

    if (!startCorner || !endCorner) {
      Alert.alert('Missing box', 'Set the graph box corners before applying values.');
      return;
    }

    const left = Math.min(startCorner.x, endCorner.x);
    const right = Math.max(startCorner.x, endCorner.x);
    const top = Math.min(startCorner.y, endCorner.y);
    const bottom = Math.max(startCorner.y, endCorner.y);

    if (right - left < 8 || bottom - top < 8) {
      Alert.alert(
        'Bounds too small',
        'Draw a larger graph box before entering digitize mode.',
      );
      return;
    }

    const parsedStart = toIsoDate(values.startDateTime);
    const existingDaySpan = session?.bounds ? Math.max(0.25, session.bounds.xMax - session.bounds.xMin) : FALLBACK_DAY_SPAN;
    const existingStageSpan = session?.bounds ? Math.max(0.1, session.bounds.yMax - session.bounds.yMin) : FALLBACK_STAGE_SPAN_FT;
    let xSpanDays = existingDaySpan;
    let ySpanFt = existingStageSpan;
    let startDateIso = parsedStart.toISOString();
    let endDateIso = new Date(parsedStart.getTime() + xSpanDays * DAY_MS).toISOString();
    let yMin = values.startStageFt;
    let yMax = values.startStageFt + ySpanFt;
    let boundsOrigin = { x: left, y: bottom };
    let boundsFar = { x: right, y: top };
    let detectedSpan: Awaited<ReturnType<typeof detectGraphPaperScale>> | null = null;
    let lowConfidenceWarning: string | null = null;

    const nextSessionPatch: Partial<DigiSession> = {
      // Changing bounds means previous points may no longer align with the active view.
      points: [],
      extractedLinePx: [],
      status: 'bounded',
    };

    if (canvasSize && canvasSize.width > 1 && canvasSize.height > 1) {
      try {
        const sourceUri = session?.croppedImageUri ?? session!.imageUri;

        if (hasFreshBoxSelection) {
          const croppedImageUri = await cropImageFromCanvasBox(sourceUri, canvasSize, {
            left,
            top,
            right,
            bottom,
          });
          nextSessionPatch.croppedImageUri = croppedImageUri;
          boundsOrigin = { x: 0, y: canvasSize.height };
          boundsFar = { x: canvasSize.width, y: 0 };
          const detected = await detectGraphPaperScale(croppedImageUri);
          if (detected) {
            detectedSpan = detected;
          }
        } else {
          if (session?.bounds) {
            boundsOrigin = session.bounds.originPx;
            boundsFar = session.bounds.farPx;
          }
          const detectionSource = session?.croppedImageUri ?? session!.imageUri;
          const detected = await detectGraphPaperScale(detectionSource);
          if (detected) {
            detectedSpan = detected;
          }
        }

        if (detectedSpan) {
          xSpanDays = detectedSpan.xSpanDays;
          ySpanFt = detectedSpan.ySpanFt;
          endDateIso = new Date(parsedStart.getTime() + xSpanDays * DAY_MS).toISOString();
          yMax = yMin + ySpanFt;
          setLastDetectedDebug(detectedSpan.debugInfo ?? null);
          if (!values.useAdvancedCalibration && (detectedSpan.confidence ?? 1) < 0.62) {
            const confidenceLabel = `${Math.round((detectedSpan.confidence ?? 0) * 100)}%`;
            lowConfidenceWarning = `Grid-scale confidence is ${confidenceLabel}. ${
              detectedSpan.lowConfidenceReason ?? ''
            } If the curve timing or stage alignment looks off, switch to Advanced Calibration and set 3 reference points.`;
          }
        } else {
          setLastDetectedDebug('Detection failed — fallback used.');
          Alert.alert(
            'Grid detection fallback',
            'Could not confidently detect graph spacing. Using previous chart span for now. You can re-draw bounds for a cleaner crop.',
          );
        }
      } catch (err) {
        console.warn('Could not crop graph image from bounds', err);
      }
    }

    if (values.useAdvancedCalibration) {
      const xStartPoint = calibrationPoints.xStart;
      const xEndPoint = calibrationPoints.xEnd;
      const yRefPoint = calibrationPoints.yRef;
      if (!xStartPoint || !xEndPoint || !yRefPoint) {
        Alert.alert(
          'Missing reference points',
          'Advanced calibration needs 3 picked points: X start, X end, and Y reference.',
        );
        return;
      }
      if (!values.xStartDateTime || !values.xEndDateTime || values.yRefStageFt == null) {
        Alert.alert(
          'Missing reference values',
          'Enter known X start time, X end time, and known Y stage value.',
        );
        return;
      }

      const knownStart = toIsoDate(values.xStartDateTime);
      const knownEnd = toIsoDate(values.xEndDateTime);
      const knownStartMs = knownStart.getTime();
      const knownEndMs = knownEnd.getTime();
      const xDeltaPx = xEndPoint.x - xStartPoint.x;
      if (!Number.isFinite(knownStartMs) || !Number.isFinite(knownEndMs) || knownEndMs <= knownStartMs) {
        Alert.alert('Invalid X references', 'Known X end time must be after known X start time.');
        return;
      }
      if (Math.abs(xDeltaPx) < 4) {
        Alert.alert('Invalid X references', 'X reference points are too close together.');
        return;
      }

      const msPerPx = (knownEndMs - knownStartMs) / xDeltaPx;
      if (!Number.isFinite(msPerPx) || msPerPx <= 0) {
        Alert.alert('Invalid X references', 'Could not compute a valid time scale from X references.');
        return;
      }

      const chartStartMs = knownStartMs + (left - xStartPoint.x) * msPerPx;
      const chartEndMs = knownStartMs + (right - xStartPoint.x) * msPerPx;
      if (!Number.isFinite(chartStartMs) || !Number.isFinite(chartEndMs) || chartEndMs <= chartStartMs) {
        Alert.alert('Invalid X references', 'Computed chart time range is invalid.');
        return;
      }

      xSpanDays = (chartEndMs - chartStartMs) / DAY_MS;
      startDateIso = new Date(chartStartMs).toISOString();
      endDateIso = new Date(chartEndMs).toISOString();

      const chartHeightPx = Math.max(1, bottom - top);
      const effectiveYSpanFt = detectedSpan?.ySpanFt ?? ySpanFt;
      const ftPerCanvasPx = effectiveYSpanFt / chartHeightPx;
      yMin = values.yRefStageFt + (yRefPoint.y - bottom) * ftPerCanvasPx;
      yMax = values.yRefStageFt + (yRefPoint.y - top) * ftPerCanvasPx;
      if (!Number.isFinite(yMin) || !Number.isFinite(yMax) || yMax <= yMin) {
        Alert.alert('Invalid Y reference', 'Could not compute a valid Y range from the Y reference.');
        return;
      }
    }

    nextSessionPatch.bounds = {
      originPx: boundsOrigin,
      farPx: boundsFar,
      xMin: 0,
      xMax: xSpanDays,
      yMin,
      yMax,
      startDate: startDateIso,
      endDate: endDateIso,
      unit: 'ft',
    };

    await updateSession(nextSessionPatch);
    setAdvancedCalibrationEnabled(values.useAdvancedCalibration);
    closeSheet();
    setPendingBoxStart(null);
    setPendingBoxEnd(null);
    setMode('digitize');
    if (lowConfidenceWarning) {
      Alert.alert('Scale Confidence Warning', lowConfidenceWarning, [
        { text: 'Keep Auto Scale', style: 'cancel' },
        {
          text: 'Use Advanced Calibration',
          onPress: () => {
            setAdvancedCalibrationEnabled(true);
            openSheet();
          },
        },
      ]);
    }
  };

  const handlePointAdded = async (point: DigiPoint) => {
    if (!session) return;
    const points = [...(session.points ?? []), point];
    await updateSession({ points, extractedLinePx: buildExtractedLine(points), status: 'digitized' });
  };

  const handlePointRemoved = async (index: number) => {
    if (!session) return;
    const points = [...(session.points ?? [])];
    points.splice(index, 1);
    await updateSession({ points, extractedLinePx: buildExtractedLine(points) });
  };

  const handlePointMoved = async (index: number, point: DigiPoint) => {
    if (!session?.bounds) return;
    const allPts = [...(session.points ?? [])];
    if (index < 0 || index >= allPts.length) return;

    const frame = imageFrame ?? {
      x: Math.min(session.bounds.originPx.x, session.bounds.farPx.x),
      y: Math.min(session.bounds.originPx.y, session.bounds.farPx.y),
      width: Math.abs(session.bounds.farPx.x - session.bounds.originPx.x),
      height: Math.abs(session.bounds.originPx.y - session.bounds.farPx.y),
    };

    const selectedOriginal = allPts[index];

    const clampPx = (px: { x: number; y: number }) => ({
      x: Math.max(frame.x, Math.min(frame.x + frame.width, px.x)),
      y: Math.max(frame.y, Math.min(frame.y + frame.height, px.y)),
    });

    const sorted = allPts
      .map((p, i) => ({ point: p, originalIndex: i }))
      .sort((a, b) => a.point.px.x - b.point.px.x);
    const sortedPos = sorted.findIndex((entry) => entry.originalIndex === index);
    const minSelectedX = sortedPos > 0 ? sorted[sortedPos - 1].point.px.x + 2 : frame.x;
    const maxSelectedX = sortedPos < sorted.length - 1 ? sorted[sortedPos + 1].point.px.x - 2 : frame.x + frame.width;
    const selectedX = Math.max(minSelectedX, Math.min(maxSelectedX, point.px.x));

    const movedPx = clampPx({ x: selectedX, y: point.px.y });
    const movedReal = pixelToReal(movedPx, session.bounds!, { width: 1, height: 1 });
    const updated = allPts.map((p, i) =>
      i === index
        ? { px: movedPx, realX: movedReal.realX, realY: movedReal.realY }
        : p,
    );

    await updateSession({ points: updated, extractedLinePx: buildExtractedLine(updated) });
  };

  const handleAutoTrace = async () => {
    if (!session?.bounds) {
      Alert.alert('Set bounds first', 'Set bounds and apply calibration before auto trace.');
      return;
    }

    const sourceUri = session.croppedImageUri ?? session.imageUri;
    if (!sourceUri) {
      Alert.alert('No image', 'No image is available for auto trace.');
      return;
    }

    setAutoTracing(true);
    try {
      const normalized = await traceGraphLineNormalized(sourceUri, FULL_TRACE_OPTIONS);
      if (normalized.length < 8) {
        Alert.alert(
          'Trace not found',
          'Could not confidently trace the line. You can still place points manually.',
        );
        return;
      }

      const frame = imageFrame
        ? imageFrame
        : {
            x: Math.min(session.bounds.originPx.x, session.bounds.farPx.x),
            y: Math.min(session.bounds.originPx.y, session.bounds.farPx.y),
            width: Math.abs(session.bounds.farPx.x - session.bounds.originPx.x),
            height: Math.abs(session.bounds.originPx.y - session.bounds.farPx.y),
          };

      if (frame.width < 2 || frame.height < 2) {
        Alert.alert('Frame not ready', 'Please wait a moment and retry auto trace.');
        return;
      }

      const tracedPoints: DigiPoint[] = normalized.map((p) => {
        const px = {
          x: frame.x + p.x * frame.width,
          y: frame.y + p.y * frame.height,
        };
        const real = pixelToReal(px, session.bounds!, { width: 1, height: 1 });
        return { px, realX: real.realX, realY: real.realY };
      });

      setPreTraceSnapshot(session.points ?? []);
      await updateSession({
        points: tracedPoints,
        extractedLinePx: tracedPoints.map((p) => p.px),
        status: 'digitized',
      });
      setMode('digitize');
      Alert.alert('Auto trace complete', `Generated ${tracedPoints.length} points.`);
    } catch (err) {
      console.warn('Auto trace failed', err);
      Alert.alert('Auto trace failed', 'Unable to auto-trace this image. Manual digitizing still works.');
    } finally {
      setAutoTracing(false);
    }
  };

  const handleUndoTrace = async () => {
    if (preTraceSnapshot === null) return;
    const pts = preTraceSnapshot;
    await updateSession({
      points: pts,
      extractedLinePx: buildExtractedLine(pts),
      status: pts.length > 0 ? 'digitized' : 'bounded',
    });
    setPreTraceSnapshot(null);
  };

  const handleExport = async () => {
    if (!session?.bounds || !session.points || session.points.length < 2) {
      Alert.alert('Not ready', 'Set boundaries and add at least 2 points before exporting.');
      return;
    }
    const records = interpolateDailyValues(session.points, session.bounds);
    if (records.length === 0) {
      Alert.alert('No data', 'Interpolation produced no records. Check boundaries and points.');
      return;
    }
    router.push(`/export/${session.id}`);
  };

  if (!session) {
    return (
      <View style={styles.centered}>
        <Text>Loading session…</Text>
      </View>
    );
  }

  const activePendingBoxStart = boxSelectionMode === 'refine' ? pendingRefineStart.current : pendingBoxStart;
  const activePendingBoxEnd = boxSelectionMode === 'refine' ? pendingRefineEnd.current : pendingBoxEnd;

  return (
    <View style={styles.root}>
      {/* Canvas */}
      <View style={styles.canvas}>
        <GraphCanvas
          imageUri={session.croppedImageUri ?? session.imageUri}
          mode={mode}
          bounds={session.bounds}
          points={session.points ?? []}
          extractedLine={session.extractedLinePx}
          pendingBoxStart={activePendingBoxStart}
          pendingBoxEnd={activePendingBoxEnd}
          calibrationPoints={calibrationPoints}
          onCanvasSizeChange={setCanvasSize}
          onImageFrameChange={setImageFrame}
          onBoxStartSet={handleBoxStartSet}
          onBoxEndSet={handleBoxEndSet}
          onCalibrationPointSet={handleCalibrationPointSet}
          onPointAdded={handlePointAdded}
          onPointRemoved={handlePointRemoved}
          onPointMoved={handlePointMoved}
        />
      </View>

      {/* Toolbar */}
      <View style={styles.toolbar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.toolbarInner}>
          <ToolBtn
            label="Set Bounds"
            active={boxSelectionMode === 'bounds' && (mode === 'setBoxStart' || mode === 'setBoxEnd')}
            onPress={() => {
              setBoxSelectionMode('bounds');
              setPendingBoxStart(null);
              setPendingBoxEnd(null);
              pendingRefineStart.current = null;
              pendingRefineEnd.current = null;
              setMode('setBoxStart');
            }}
          />
          <ToolBtn
            label="Edit Values"
            active={false}
            disabled={!session.bounds}
            onPress={() => {
              // Re-open form to adjust start time/stage without re-tapping the graph box.
              openSheet();
            }}
          />
          <ToolBtn
            label={autoTracing ? 'Tracing…' : 'Auto Trace'}
            active={false}
            disabled={!session.bounds || autoTracing}
            onPress={handleAutoTrace}
          />
          {preTraceSnapshot !== null ? (
            <ToolBtn
              label="Undo Trace"
              active={false}
              onPress={handleUndoTrace}
            />
          ) : null}
          <ToolBtn
            label={autoTracing ? 'Refining…' : 'Refine Box'}
            active={boxSelectionMode === 'refine' && (mode === 'setBoxStart' || mode === 'setBoxEnd')}
            disabled={!session.bounds || autoTracing}
            onPress={() => {
              setBoxSelectionMode('refine');
              pendingRefineStart.current = null;
              pendingRefineEnd.current = null;
              setMode('setBoxStart');
            }}
          />
          <ToolBtn
            label={`Points: ${session.points?.length ?? 0}`}
            active={false}
            onPress={() => setShowPointsModal(true)}
          />
          <ToolBtn
            label="Export CSV"
            active={false}
            highlight
            disabled={!session.bounds || (session.points?.length ?? 0) < 2}
            onPress={handleExport}
          />
        </ScrollView>
      </View>

      {/* Slide-up bounds form — graph stays visible above the sheet */}
      {showBoundsForm ? (
        <Animated.View
          style={[
            styles.bottomSheet,
            {
              transform: [
                {
                  translateY: sheetAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [SHEET_HEIGHT, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <BoundaryEditor
            initial={session.bounds}
            defaultUseAdvancedCalibration={advancedCalibrationEnabled}
            calibrationPointStatus={{
              xStart: Boolean(calibrationPoints.xStart),
              xEnd: Boolean(calibrationPoints.xEnd),
              yRef: Boolean(calibrationPoints.yRef),
            }}
            onPickCalibrationPoints={beginAdvancedCalibrationSelection}
            onSave={handleBoundsSave}
            onCancel={closeSheet}
          />
        </Animated.View>
      ) : null}

      <Modal
        visible={showPointsModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPointsModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.pointsModalCard}>
            <View style={styles.pointsModalHeader}>
              <Text style={styles.pointsModalTitle}>Point Values</Text>
              <TouchableOpacity onPress={() => setShowPointsModal(false)} style={styles.pointsModalCloseBtn}>
                <Text style={styles.pointsModalCloseText}>Close</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.pointsModalSubtitle}>
              {sortedPoints.length} point{sortedPoints.length === 1 ? '' : 's'} sorted left to right.
            </Text>
            {lastDetectedDebug ? (
              <Text style={[styles.pointsModalSubtitle, { fontSize: 10, color: '#888', marginTop: 2 }]}>
                Grid: {lastDetectedDebug}
              </Text>
            ) : null}
            <ScrollView style={styles.pointsList} contentContainerStyle={styles.pointsListContent}>
              {sortedPoints.length === 0 ? (
                <Text style={styles.pointsEmptyText}>No points yet. Run Auto Trace or add points directly on the graph.</Text>
              ) : (
                sortedPoints.map((point, index) => {
                  const timestamp = formatPointTimestamp(point);
                  return (
                    <View key={`${point.realX}-${point.realY}-${index}`} style={styles.pointRow}>
                      <Text style={styles.pointRowTitle}>Point {index + 1}</Text>
                      <Text style={styles.pointRowText}>Stage: {point.realY.toFixed(3)} {session?.bounds?.unit ?? ''}</Text>
                      <Text style={styles.pointRowText}>X offset: {point.realX.toFixed(4)} days</Text>
                      {timestamp ? <Text style={styles.pointRowText}>Time: {timestamp}</Text> : null}
                    </View>
                  );
                })
              )}
            </ScrollView>
            <View style={styles.pointsModalActions}>
              <TouchableOpacity
                style={[styles.modalActionBtn, sortedPoints.length === 0 && styles.toolBtnDisabled]}
                disabled={sortedPoints.length === 0}
                onPress={() => {
                  Alert.alert(
                    'Clear Points',
                    'Remove all digitized points?',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Clear',
                        style: 'destructive',
                        onPress: async () => {
                          await updateSession({ points: [], extractedLinePx: [] });
                          setShowPointsModal(false);
                        },
                      },
                    ],
                  );
                }}
              >
                <Text style={styles.modalActionText}>Clear Points</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function ToolBtn({
  label,
  active,
  highlight,
  disabled,
  onPress,
}: {
  label: string;
  active: boolean;
  highlight?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.toolBtn,
        active && styles.toolBtnActive,
        highlight && styles.toolBtnHighlight,
        disabled && styles.toolBtnDisabled,
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text
        style={[
          styles.toolBtnText,
          active && styles.toolBtnTextActive,
          highlight && styles.toolBtnTextHighlight,
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  canvas: { flex: 1 },
  toolbar: {
    backgroundColor: Colors.primaryDark,
    paddingVertical: Spacing.sm,
  },
  toolbarInner: { paddingHorizontal: Spacing.sm, gap: Spacing.xs, flexDirection: 'row' },
  toolBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  toolBtnActive: { backgroundColor: Colors.primaryLight, borderColor: Colors.accent },
  toolBtnHighlight: { backgroundColor: Colors.success, borderColor: Colors.success },
  toolBtnDisabled: { opacity: 0.35 },
  toolBtnText: { color: 'rgba(255,255,255,0.8)', fontSize: FontSize.sm },
  toolBtnTextActive: { color: '#fff', fontWeight: '700' },
  toolBtnTextHighlight: { color: '#fff', fontWeight: '700' },
  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 18,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  pointsModalCard: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '80%',
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  pointsModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  pointsModalTitle: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.text,
  },
  pointsModalSubtitle: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
  },
  pointsModalCloseBtn: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  pointsModalCloseText: {
    color: Colors.primary,
    fontSize: FontSize.sm,
    fontWeight: '700',
  },
  pointsList: {
    minHeight: 160,
  },
  pointsListContent: {
    gap: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  pointsEmptyText: {
    color: Colors.textMuted,
    fontSize: FontSize.sm,
  },
  pointRow: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: Spacing.sm,
    gap: 4,
    backgroundColor: Colors.background,
  },
  pointRowTitle: {
    color: Colors.text,
    fontSize: FontSize.md,
    fontWeight: '700',
  },
  pointRowText: {
    color: Colors.textMuted,
    fontSize: FontSize.sm,
  },
  pointsModalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  modalActionBtn: {
    backgroundColor: Colors.error,
    borderRadius: 10,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  modalActionText: {
    color: '#fff',
    fontSize: FontSize.sm,
    fontWeight: '700',
  },
});
