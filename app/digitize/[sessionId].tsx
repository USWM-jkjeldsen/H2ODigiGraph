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
  TextInput,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import {
  GraphCanvas,
  type CanvasMode,
  type CalibrationPointKey,
} from '../../src/components/GraphCanvas';
import { BoundaryEditor, type BoundaryValues } from '../../src/components/BoundaryEditor';
import { getSessions, getUserTraceSettings, saveSession, saveUserTraceSettings } from '../../src/lib/storage';
import { interpolateDailyValues, pixelToReal } from '../../src/lib/digitizer';
import type { DigiSession, DigiPoint, UserTraceSettings } from '../../src/lib/types';
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
const DEFAULT_TRACE_SETTINGS: UserTraceSettings = {
  pencilColor: '#6d6d6d',
  gridColor: '#3e9bd1',
};

function formatLocalDatePart(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatLocalTimePart(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function parseDateTimeLike(value: string): Date | null {
  if (!value) return null;
  const normalized = value.replace(' ', 'T');
  const parsed = new Date(normalized);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }
  const fallback = new Date(value);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function extractDatePart(value: string): string {
  const parsed = parseDateTimeLike(value);
  if (parsed) return formatLocalDatePart(parsed);
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

function extractTimePart(value: string): string {
  const parsed = parseDateTimeLike(value);
  if (parsed) return formatLocalTimePart(parsed);
  const match = value.match(/(\d{2}:\d{2})/);
  return match ? match[1] : '';
}

function mergeDateAndTime(datePart: string, timePart: string): string {
  if (!datePart) return '';
  return `${datePart} ${timePart || '00:00'}`;
}

function normalizeDatePart(input: string): string {
  if (!input) return '';
  const trimmed = input.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const slash = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const mm = slash[1].padStart(2, '0');
    const dd = slash[2].padStart(2, '0');
    const yyyy = slash[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  return trimmed;
}

function normalizeTimePart(input: string): string {
  if (!input) return '00:00';
  const trimmed = input.trim();
  const hhmm = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (!hhmm) return trimmed;
  const hh = hhmm[1].padStart(2, '0');
  return `${hh}:${hhmm[2]}`;
}

function normalizeHexColor(input: string): string {
  const raw = input.trim().replace('#', '').toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(raw)) return '';
  return `#${raw}`;
}

const WEB_DATE_TIME_INPUT_STYLE: React.CSSProperties = {
  width: '100%',
  maxWidth: '100%',
  boxSizing: 'border-box',
  border: `1px solid ${Colors.border}`,
  borderRadius: 8,
  padding: '8px 10px',
  fontSize: FontSize.md,
  color: Colors.text,
  backgroundColor: Colors.surfaceDim,
  outline: 'none',
};

export default function DigitizeScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();
  const [session, setSession] = useState<DigiSession | null>(null);
  const [mode, setMode] = useState<CanvasMode>('idle');
  const [pendingBoxStart, setPendingBoxStart] = useState<{ x: number; y: number } | null>(null);
  const [pendingBoxEnd, setPendingBoxEnd] = useState<{ x: number; y: number } | null>(null);
  const pendingBoxStartRef = useRef<{ x: number; y: number } | null>(null);
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
  const [guidedStep, setGuidedStep] = useState<'idle' | 'pickX0' | 'pickYRef' | 'pickX1'>('idle');
  const [valueModalStep, setValueModalStep] = useState<'x0' | 'yRef' | 'x1' | null>(null);
  const [valueModalError, setValueModalError] = useState<string | null>(null);
  const [x0DateTimeDraft, setX0DateTimeDraft] = useState('');
  const [x0StageDraft, setX0StageDraft] = useState('');
  const [yRefStageDraft, setYRefStageDraft] = useState('');
  const [x1DateTimeDraft, setX1DateTimeDraft] = useState('');
  const [x1StageDraft, setX1StageDraft] = useState('');
  const [x0DatePartDraft, setX0DatePartDraft] = useState('');
  const [x0TimePartDraft, setX0TimePartDraft] = useState('00:00');
  const [x1DatePartDraft, setX1DatePartDraft] = useState('');
  const [x1TimePartDraft, setX1TimePartDraft] = useState('00:00');
  const [traceSettings, setTraceSettings] = useState<UserTraceSettings>(DEFAULT_TRACE_SETTINGS);
  const [showTraceSettingsModal, setShowTraceSettingsModal] = useState(false);
  const [traceSettingsError, setTraceSettingsError] = useState<string | null>(null);
  const lastFrameSnapshotRef = useRef<{
    sourceUri: string;
    frame: { x: number; y: number; width: number; height: number };
  } | null>(null);
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
        const [sessions, storedTraceSettings] = await Promise.all([
          getSessions(),
          getUserTraceSettings(),
        ]);
        const found = sessions.find((s) => s.id === sessionId) ?? null;
        setSession(found);
        setTraceSettings(storedTraceSettings);
      })();
    }, [sessionId]),
  );

  const updateSession = async (updates: Partial<DigiSession>) => {
    if (!session) return;
    const updated = { ...session, ...updates };
    setSession(updated);
    await saveSession(updated);
  };

  const getTraceOptions = useCallback(() => {
    const pencilColor = normalizeHexColor(traceSettings.pencilColor);
    const gridColor = normalizeHexColor(traceSettings.gridColor);
    return {
      ...FULL_TRACE_OPTIONS,
      pencilColorHex: pencilColor || undefined,
      gridColorHex: gridColor || undefined,
    };
  }, [traceSettings.gridColor, traceSettings.pencilColor]);

  const handleSaveTraceSettings = async () => {
    const pencilColor = normalizeHexColor(traceSettings.pencilColor);
    const gridColor = normalizeHexColor(traceSettings.gridColor);
    if (!pencilColor || !gridColor) {
      setTraceSettingsError('Use full hex colors like #6d6d6d and #3e9bd1.');
      return;
    }
    const next = { pencilColor, gridColor };
    setTraceSettings(next);
    await saveUserTraceSettings(next);
    setTraceSettingsError(null);
    setShowTraceSettingsModal(false);
    setMode('digitize');
  };

  const beginColorSampling = (target: 'pencil' | 'grid') => {
    setShowTraceSettingsModal(false);
    setTraceSettingsError(null);
    setMode(target === 'pencil' ? 'pickPencilColor' : 'pickGridColor');
    Alert.alert(
      target === 'pencil' ? 'Sample Pencil Color' : 'Sample Grid Color',
      target === 'pencil'
        ? 'Tap a representative pencil/trace segment on the chart.'
        : 'Tap a representative gridline on the chart.',
    );
  };

  const handleTraceColorSampled = useCallback(async (target: 'pencil' | 'grid', hex: string) => {
    const normalized = normalizeHexColor(hex);
    if (!normalized) {
      Alert.alert('Sample failed', 'Could not sample a valid color. Try again.');
      return;
    }
    const next = target === 'pencil'
      ? { ...traceSettings, pencilColor: normalized }
      : { ...traceSettings, gridColor: normalized };
    setTraceSettings(next);
    await saveUserTraceSettings(next);
    setMode('digitize');
    Alert.alert('Color saved', `${target === 'pencil' ? 'Pencil' : 'Grid'} color set to ${normalized}.`);
  }, [traceSettings]);

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
        ...getTraceOptions(),
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
        digitizedAt: session.digitizedAt ?? new Date().toISOString(),
      });
      Alert.alert('Refine complete', `Updated ${tracedSegment.length} points in selected section.`);
    } catch (err) {
      console.warn('Refine box trace failed', err);
      Alert.alert('Refine failed', 'Could not refine this section. Try a slightly larger box.');
    } finally {
      setAutoTracing(false);
    }
  }, [buildExtractedLine, getTraceOptions, resolveFrame, session, updateSession]);

  // Step 1: bottom-left corner, Step 2: top-right corner
  const handleBoxStartSet = (px: { x: number; y: number }) => {
    if (boxSelectionMode === 'refine') {
      pendingRefineStart.current = px;
      pendingRefineEnd.current = null;
      setMode('setBoxEnd');
      return;
    }
    pendingBoxStartRef.current = px;
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

    const start = pendingBoxStartRef.current ?? pendingBoxStart ?? px;
    const left = Math.min(start.x, px.x);
    const right = Math.max(start.x, px.x);
    const top = Math.min(start.y, px.y);
    const bottom = Math.max(start.y, px.y);
    if (right - left < 8 || bottom - top < 8) {
      Alert.alert('Bounds too small', 'Draw a larger box around the line to crop and calibrate.');
      return;
    }

    setPendingBoxEnd(px);

    if (session && canvasSize && canvasSize.width > 1 && canvasSize.height > 1) {
      try {
        const sourceUri = session.croppedImageUri ?? session.imageUri;
        const croppedImageUri = await cropImageFromCanvasBox(sourceUri, canvasSize, {
          left,
          top,
          right,
          bottom,
        });
        await updateSession({
          croppedImageUri,
          bounds: undefined,
          points: [],
          extractedLinePx: [],
          status: 'captured',
          digitizedAt: undefined,
          exportedAt: undefined,
        });
      } catch (err) {
        console.warn('Could not crop/zoom selected bounds', err);
        Alert.alert('Crop failed', 'Could not crop this box. Calibration will continue on the current view.');
      }
    }

    setPendingBoxStart(null);
    setPendingBoxEnd(null);
  pendingBoxStartRef.current = null;
    setBoxSelectionMode(null);
    setCalibrationPoints({});
    setGuidedStep('pickX0');
    setValueModalStep(null);
    setMode('setCalXStart');
    Alert.alert(
      'Calibration Step 1 of 3',
      'Image is now cropped to your selected box. Tap the x0 point (left-side start point on the traced line).',
    );
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
    setGuidedStep('pickX0');
    setValueModalStep(null);
    setValueModalError(null);
    setMode('setCalXStart');
    Alert.alert(
      'Calibration Step 1 of 3',
      'Tap the x0 point (left-side start point on the traced line).',
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

    if (guidedStep === 'pickX0' && key === 'xStart') {
      setCalibrationPoints((prev) => ({ ...prev, xStart: px }));
      setValueModalError(null);
      setX0DatePartDraft(extractDatePart(x0DateTimeDraft));
      setX0TimePartDraft(extractTimePart(x0DateTimeDraft) || '00:00');
      setValueModalStep('x0');
      setMode('idle');
      return;
    }

    if (guidedStep === 'pickYRef' && key === 'yRef') {
      setCalibrationPoints((prev) => ({ ...prev, yRef: px }));
      setValueModalError(null);
      setValueModalStep('yRef');
      setMode('idle');
      return;
    }

    if (guidedStep === 'pickX1' && key === 'xEnd') {
      setCalibrationPoints((prev) => ({ ...prev, xEnd: px }));
      setValueModalError(null);
      setX1DatePartDraft(extractDatePart(x1DateTimeDraft));
      setX1TimePartDraft(extractTimePart(x1DateTimeDraft) || '00:00');
      setValueModalStep('x1');
      setMode('idle');
      return;
    }

    Alert.alert('Unexpected point', 'Please follow the prompts in order: x0, known Y, then x1.');
  };

  const toIsoDate = (dateLike: string) => {
    const parsed = new Date(dateLike.replace(' ', 'T'));
    return Number.isNaN(parsed.getTime()) ? new Date(dateLike) : parsed;
  };

  const applyGuidedCalibrationAndTrace = async (input?: {
    x0DateTime?: string;
    x1DateTime?: string;
    x0Stage?: string;
    yRefStage?: string;
    x1Stage?: string;
  }) => {
    if (!session || !imageFrame) {
      Alert.alert('Missing data', 'Please redraw the trace box and calibration points.');
      return;
    }

    const xStartPoint = calibrationPoints.xStart;
    const xEndPoint = calibrationPoints.xEnd;
    const yRefPoint = calibrationPoints.yRef;
    if (!xStartPoint || !xEndPoint || !yRefPoint) {
      Alert.alert('Missing points', 'Calibration requires x0, known Y, and x1 points.');
      return;
    }

    if (xEndPoint.x <= xStartPoint.x) {
      Alert.alert('Invalid x points', 'x1 must be to the right of x0 on the chart.');
      return;
    }

    const x0Date = toIsoDate(input?.x0DateTime ?? x0DateTimeDraft);
    const x1Date = toIsoDate(input?.x1DateTime ?? x1DateTimeDraft);
    const x0Ms = x0Date.getTime();
    const x1Ms = x1Date.getTime();
    const x0Stage = parseFloat(input?.x0Stage ?? x0StageDraft);
    const yRefStage = parseFloat(input?.yRefStage ?? yRefStageDraft);
    const x1Stage = parseFloat(input?.x1Stage ?? x1StageDraft);
    if (!Number.isFinite(x0Ms) || !Number.isFinite(x1Ms) || x1Ms <= x0Ms) {
      Alert.alert('Invalid time values', 'x1 date/time must be after x0 date/time.');
      return;
    }
    if (!Number.isFinite(x0Stage) || !Number.isFinite(yRefStage) || !Number.isFinite(x1Stage)) {
      Alert.alert('Invalid stage values', 'Stage values for x0, known Y, and x1 are required.');
      return;
    }

    const left = imageFrame.x;
    const right = imageFrame.x + imageFrame.width;
    const top = imageFrame.y;
    const bottom = imageFrame.y + imageFrame.height;
    if (right - left < 8 || bottom - top < 8) {
      Alert.alert('Bounds too small', 'Draw a larger trace box around the line.');
      return;
    }

    const xDeltaPx = xEndPoint.x - xStartPoint.x;
    if (Math.abs(xDeltaPx) < 4) {
      Alert.alert('Invalid x calibration', 'x0 and x1 points are too close together.');
      return;
    }

    const msPerPx = (x1Ms - x0Ms) / xDeltaPx;
    // Use x0/x1 directly as the bounds anchors — no extrapolation to box edges

    const fitPoints = [
      { py: xStartPoint.y, stage: x0Stage },
      { py: yRefPoint.y, stage: yRefStage },
      { py: xEndPoint.y, stage: x1Stage },
    ];
    const n = fitPoints.length;
    const sumY = fitPoints.reduce((acc, p) => acc + p.py, 0);
    const sumS = fitPoints.reduce((acc, p) => acc + p.stage, 0);
    const sumYY = fitPoints.reduce((acc, p) => acc + p.py * p.py, 0);
    const sumYS = fitPoints.reduce((acc, p) => acc + p.py * p.stage, 0);
    const den = n * sumYY - sumY * sumY;
    if (Math.abs(den) < 1e-6) {
      Alert.alert('Invalid y calibration', 'The selected Y calibration points are too close together.');
      return;
    }

    const slope = (n * sumYS - sumY * sumS) / den;
    const intercept = (sumS - slope * sumY) / n;
    const yTopStage = intercept + slope * top;
    const yBottomStage = intercept + slope * bottom;
    const yMin = Math.min(yTopStage, yBottomStage);
    const yMax = Math.max(yTopStage, yBottomStage);
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax) || yMax - yMin < 0.001) {
      Alert.alert('Invalid y scale', 'Could not compute a stable y scale from the three stage values.');
      return;
    }

    // Anchor coordinate system exactly at x0/x1 — no data outside user-calibrated range
    const xSpanDays = (x1Ms - x0Ms) / DAY_MS;
    const nextBounds = {
      originPx: { x: xStartPoint.x, y: bottom },
      farPx: { x: xEndPoint.x, y: top },
      xMin: 0,
      xMax: xSpanDays,
      yMin,
      yMax,
      startDate: x0Date.toISOString(),
      endDate: x1Date.toISOString(),
      unit: 'ft' as const,
    };

    await updateSession({
      bounds: nextBounds,
      points: [],
      extractedLinePx: [],
      status: 'bounded',
      digitizedAt: undefined,
    });

    const clampNorm = (v: number) => Math.max(0, Math.min(1, v));
    const xNormMargin = 0.01;
    const xNormStart = clampNorm((xStartPoint.x - imageFrame.x) / imageFrame.width - xNormMargin);
    const xNormEnd = clampNorm((xEndPoint.x - imageFrame.x) / imageFrame.width + xNormMargin);
    // Use average y of x0/x1 — both were tapped directly on the line, so this
    // points the tracer at the actual line rather than the Y-ref annotation.
    // The image is already cropped to the box, so use a generous band (±40%) so
    // the full excursion of the line is reachable even when x0 and x1 happen to
    // be at similar heights (which would otherwise collapse the band to near zero).
    const lineYAvg = (xStartPoint.y + xEndPoint.y) / 2;
    const yNormHint = clampNorm((lineYAvg - imageFrame.y) / imageFrame.height);
    const yNormBand = 0.45;

    setAutoTracing(true);
    try {
      const normalized = await traceGraphLineNormalized(session.croppedImageUri ?? session.imageUri, {
        ...getTraceOptions(),
        xNormStart,
        xNormEnd,
        yNormHint,
        yNormBand,
      });
      if (normalized.length < 8) {
        Alert.alert('Trace not found', 'Calibration saved, but auto-trace could not find the line confidently.');
      } else {
        let tracedRaw: DigiPoint[] = normalized.map((p) => {
          const px = {
            x: imageFrame.x + p.x * imageFrame.width,
            y: imageFrame.y + p.y * imageFrame.height,
          };
          const real = pixelToReal(px, nextBounds, { width: 1, height: 1 });
          return { px, realX: real.realX, realY: real.realY };
        }).filter((point) => point.px.x >= xStartPoint.x && point.px.x <= xEndPoint.x);

        // Repair right tail when the first pass stops short of x1 and creates a long straight bridge.
        const rightMostX = tracedRaw.reduce((maxX, point) => Math.max(maxX, point.px.x), xStartPoint.x);
        const tailGapPx = xEndPoint.x - rightMostX;
        if (tailGapPx > Math.max(18, imageFrame.width * 0.04)) {
          const tailStartNorm = clampNorm((rightMostX - imageFrame.x) / imageFrame.width - 0.02);
          const tailEndNorm = clampNorm((xEndPoint.x - imageFrame.x) / imageFrame.width + 0.01);
          const tailHintNorm = clampNorm((xEndPoint.y - imageFrame.y) / imageFrame.height);
          const tailBand = 0.22;

          const tailNormalized = await traceGraphLineNormalized(session.croppedImageUri ?? session.imageUri, {
            ...getTraceOptions(),
            xSamples: 110,
            xNormStart: tailStartNorm,
            xNormEnd: tailEndNorm,
            yNormHint: tailHintNorm,
            yNormBand: tailBand,
          });

          if (tailNormalized.length >= 3) {
            const tailPoints = tailNormalized.map((p) => {
              const px = {
                x: imageFrame.x + p.x * imageFrame.width,
                y: imageFrame.y + p.y * imageFrame.height,
              };
              const real = pixelToReal(px, nextBounds, { width: 1, height: 1 });
              return { px, realX: real.realX, realY: real.realY };
            }).filter((point) => point.px.x >= xStartPoint.x && point.px.x <= xEndPoint.x);

            // Keep tail detail, but avoid over-densifying this repair segment.
            const tailSpacingPx = Math.max(2.5, imageFrame.width * 0.0035);
            const thinnedTail: DigiPoint[] = [];
            let lastAcceptedX = Number.NEGATIVE_INFINITY;
            for (const point of tailPoints.sort((a, b) => a.px.x - b.px.x)) {
              if (point.px.x - lastAcceptedX >= tailSpacingPx || point.px.x >= xEndPoint.x - 1) {
                thinnedTail.push(point);
                lastAcceptedX = point.px.x;
              }
            }

            const mergedByX = new Map<number, DigiPoint>();
            for (const point of [...tracedRaw, ...thinnedTail]) {
              mergedByX.set(Math.round(point.px.x * 2), point);
            }
            tracedRaw = Array.from(mergedByX.values()).sort((a, b) => a.px.x - b.px.x);
          }
        }

        // Keep interior traced points, but pin the series to exact x0/x1 calibration
        // anchors so exported values always honor the entered endpoint stages.
        const edgeTolerancePx = Math.max(1, imageFrame.width * 0.002);
        const interior = tracedRaw.filter((point) => (
          point.px.x > xStartPoint.x + edgeTolerancePx
          && point.px.x < xEndPoint.x - edgeTolerancePx
        ));

        const tracedPoints: DigiPoint[] = [
          { px: xStartPoint, realX: 0, realY: x0Stage },
          ...interior,
          { px: xEndPoint, realX: xSpanDays, realY: x1Stage },
        ];

        if (tracedPoints.length < 8) {
          Alert.alert('Trace constrained', 'Calibration saved, but only a few points were found between x0 and x1.');
          return;
        }

        await updateSession({
          bounds: nextBounds,
          points: tracedPoints,
          extractedLinePx: tracedPoints.map((p) => p.px),
          status: 'digitized',
          digitizedAt: session.digitizedAt ?? new Date().toISOString(),
        });
      }
    } catch (err) {
      console.warn('Guided auto trace failed', err);
      Alert.alert('Auto trace failed', 'Calibration was saved. You can still add points manually.');
    } finally {
      setAutoTracing(false);
    }

    setGuidedStep('idle');
    setValueModalStep(null);
    setValueModalError(null);
    setMode('digitize');
    Alert.alert('Calibration complete', 'Scale is set from x0, known Y, and x1. Auto-trace has been applied.');
  };

  const handleValueModalContinue = async () => {
    if (valueModalStep === 'x0') {
      const nextDate = normalizeDatePart(x0DatePartDraft);
      const nextTime = normalizeTimePart(x0TimePartDraft);
      const composed = mergeDateAndTime(nextDate, nextTime);
      setX0DateTimeDraft(composed);
      const stage = parseFloat(x0StageDraft);
      const parsed = toIsoDate(composed);
      if (!Number.isFinite(parsed.getTime())) {
        setValueModalError('Enter a valid x0 date/time. Use YYYY-MM-DD (or MM/DD/YYYY) and HH:mm.');
        return;
      }
      if (!Number.isFinite(stage)) {
        setValueModalError('Enter a valid x0 stage value.');
        return;
      }
      setValueModalStep(null);
      setValueModalError(null);
      setGuidedStep('pickYRef');
      setMode('setCalYRef');
      Alert.alert('Calibration Step 2 of 3', 'Tap a point where you know the stage from the chart scale.');
      return;
    }

    if (valueModalStep === 'yRef') {
      const stage = parseFloat(yRefStageDraft);
      if (!Number.isFinite(stage)) {
        setValueModalError('Enter a valid known Y stage value.');
        return;
      }
      setValueModalStep(null);
      setValueModalError(null);
      setGuidedStep('pickX1');
      setMode('setCalXEnd');
      Alert.alert('Calibration Step 3 of 3', 'Tap the x1 end point on the traced line.');
      return;
    }

    if (valueModalStep === 'x1') {
      const nextDate = normalizeDatePart(x1DatePartDraft);
      const nextTime = normalizeTimePart(x1TimePartDraft);
      const composed = mergeDateAndTime(nextDate, nextTime);
      setX1DateTimeDraft(composed);
      const stage = parseFloat(x1StageDraft);
      const parsed = toIsoDate(composed);
      if (!Number.isFinite(parsed.getTime())) {
        setValueModalError('Enter a valid x1 date/time. Use YYYY-MM-DD (or MM/DD/YYYY) and HH:mm.');
        return;
      }
      if (!Number.isFinite(stage)) {
        setValueModalError('Enter a valid x1 stage value.');
        return;
      }
      setValueModalStep(null);
      setValueModalError(null);
      await applyGuidedCalibrationAndTrace({
        x0DateTime: mergeDateAndTime(normalizeDatePart(x0DatePartDraft), normalizeTimePart(x0TimePartDraft)),
        x1DateTime: composed,
        x0Stage: x0StageDraft,
        yRefStage: yRefStageDraft,
        x1Stage: x1StageDraft,
      });
    }
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
    if (!session || !imageFrame || imageFrame.width < 2 || imageFrame.height < 2) return;

    const sourceUri = session.croppedImageUri ?? session.imageUri;
    const prev = lastFrameSnapshotRef.current;
    if (!prev || prev.sourceUri !== sourceUri) {
      lastFrameSnapshotRef.current = { sourceUri, frame: imageFrame };
      return;
    }

    const frameMovedOrResized =
      Math.abs(prev.frame.x - imageFrame.x) > 1 ||
      Math.abs(prev.frame.y - imageFrame.y) > 1 ||
      Math.abs(prev.frame.width - imageFrame.width) > 1 ||
      Math.abs(prev.frame.height - imageFrame.height) > 1;

    lastFrameSnapshotRef.current = { sourceUri, frame: imageFrame };
    if (!frameMovedOrResized) return;

    const hadCalibrationOrTrace = Boolean(session.bounds) || (session.points?.length ?? 0) > 0;
    if (!hadCalibrationOrTrace) return;

    // Screen/layout scale changed; stored pixel-space calibration is no longer valid.
    setCalibrationPoints({});
    setValueModalStep(null);
    setValueModalError(null);
    setX0DateTimeDraft('');
    setX0StageDraft('');
    setYRefStageDraft('');
    setX1DateTimeDraft('');
    setX1StageDraft('');
    setPendingBoxStart(null);
    setPendingBoxEnd(null);
    pendingBoxStartRef.current = null;
    pendingRefineStart.current = null;
    pendingRefineEnd.current = null;
    setPreTraceSnapshot(null);
    setBoxSelectionMode(null);

    if (session.croppedImageUri) {
      setGuidedStep('pickX0');
      setMode('setCalXStart');
    } else {
      setGuidedStep('idle');
      setMode('setBoxStart');
    }

    void updateSession({
      bounds: undefined,
      points: [],
      extractedLinePx: [],
      status: 'captured',
      digitizedAt: undefined,
      exportedAt: undefined,
    });

    Alert.alert(
      'Screen size changed',
      session.croppedImageUri
        ? 'Calibration and auto-trace were cleared. Tap x0 to recalibrate this cropped view.'
        : 'Calibration and auto-trace were cleared. Draw bounds again to continue.',
    );
  }, [imageFrame, session, updateSession]);

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
      digitizedAt: undefined,
      exportedAt: undefined,
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
    await updateSession({
      points,
      extractedLinePx: buildExtractedLine(points),
      status: 'digitized',
      digitizedAt: session.digitizedAt ?? new Date().toISOString(),
    });
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

      const xBoundMin = Math.min(session.bounds.originPx.x, session.bounds.farPx.x);
      const xBoundMax = Math.max(session.bounds.originPx.x, session.bounds.farPx.x);
      const clampNorm = (v: number) => Math.max(0, Math.min(1, v));
      const xNormStart = clampNorm((xBoundMin - frame.x) / frame.width - 0.01);
      const xNormEnd = clampNorm((xBoundMax - frame.x) / frame.width + 0.01);

      const normalized = await traceGraphLineNormalized(sourceUri, {
        ...getTraceOptions(),
        xNormStart,
        xNormEnd,
      });
      if (normalized.length < 5) {
        Alert.alert(
          'Trace not found',
          'Could not confidently trace the line. You can still place points manually.',
        );
        return;
      }

      const tracedPoints: DigiPoint[] = normalized.map((p) => {
        const px = {
          x: frame.x + p.x * frame.width,
          y: frame.y + p.y * frame.height,
        };
        const real = pixelToReal(px, session.bounds!, { width: 1, height: 1 });
        return { px, realX: real.realX, realY: real.realY };
      }).filter((point) => point.px.x >= xBoundMin && point.px.x <= xBoundMax);

      if (tracedPoints.length < 5) {
        Alert.alert('Trace constrained', 'Trace points were outside calibrated x0..x1 bounds. Try refine box or adjust colors.');
        return;
      }

      setPreTraceSnapshot(session.points ?? []);
      await updateSession({
        points: tracedPoints,
        extractedLinePx: tracedPoints.map((p) => p.px),
        status: 'digitized',
        digitizedAt: session.digitizedAt ?? new Date().toISOString(),
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
      digitizedAt: pts.length > 0 ? session?.digitizedAt ?? new Date().toISOString() : undefined,
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

  if (Platform.OS !== 'web') {
    return (
      <View style={styles.centered}>
        <Text style={styles.mobileBlockTitle}>Digitizing is desktop-only</Text>
        <Text style={styles.mobileBlockBody}>
          On phones, this app now only captures and attaches chart photos. Open this session on desktop web to calibrate and trace.
        </Text>
        <TouchableOpacity style={styles.mobileBlockBtn} onPress={() => router.back()}>
          <Text style={styles.mobileBlockBtnText}>Back</Text>
        </TouchableOpacity>
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
          onTraceColorSampled={(target, hex) => {
            void handleTraceColorSampled(target, hex);
          }}
        />
      </View>

      {/* Toolbar */}
      <View style={styles.toolbar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.toolbarInner}>
          {/* Before the box is drawn: offer Set Bounds. After crop: only Reset Bounds. */}
          {!session.croppedImageUri ? (
            <ToolBtn
              label="Set Bounds"
              active={boxSelectionMode === 'bounds' && (mode === 'setBoxStart' || mode === 'setBoxEnd')}
              onPress={() => {
                setBoxSelectionMode('bounds');
                setPendingBoxStart(null);
                setPendingBoxEnd(null);
                pendingBoxStartRef.current = null;
                setCalibrationPoints({});
                setGuidedStep('idle');
                setValueModalStep(null);
                setValueModalError(null);
                setX0DateTimeDraft('');
                setX0StageDraft('');
                setYRefStageDraft('');
                setX1DateTimeDraft('');
                setX1StageDraft('');
                pendingRefineStart.current = null;
                pendingRefineEnd.current = null;
                setMode('setBoxStart');
              }}
            />
          ) : (
            <ToolBtn
              label="Reset Bounds"
              active={false}
              onPress={() => {
                // Clear the crop back to the original image and start box-drawing fresh
                updateSession({
                  croppedImageUri: undefined,
                  bounds: undefined,
                  points: [],
                  extractedLinePx: [],
                  status: 'new',
                  digitizedAt: undefined,
                  exportedAt: undefined,
                });
                setBoxSelectionMode('bounds');
                setPendingBoxStart(null);
                setPendingBoxEnd(null);
                pendingBoxStartRef.current = null;
                setCalibrationPoints({});
                setGuidedStep('idle');
                setValueModalStep(null);
                setValueModalError(null);
                setX0DateTimeDraft('');
                setX0StageDraft('');
                setYRefStageDraft('');
                setX1DateTimeDraft('');
                setX1StageDraft('');
                pendingRefineStart.current = null;
                pendingRefineEnd.current = null;
                setMode('setBoxStart');
              }}
            />
          )}
          <ToolBtn
            label="Restart Calibration"
            active={false}
            disabled={autoTracing || !session.croppedImageUri}
            onPress={() => {
              // Keep the cropped image — just wipe the calibration and start picking x0 again
              setCalibrationPoints({});
              setGuidedStep('pickX0');
              setValueModalStep(null);
              setValueModalError(null);
              setX0DateTimeDraft('');
              setX0StageDraft('');
              setYRefStageDraft('');
              setX1DateTimeDraft('');
              setX1StageDraft('');
              setMode('setCalXStart');
              Alert.alert('Tap x0', 'Tap the x0 start point on the line.');
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
            label="Trace Colors"
            active={showTraceSettingsModal || mode === 'pickPencilColor' || mode === 'pickGridColor'}
            disabled={autoTracing}
            onPress={() => {
              setTraceSettingsError(null);
              setShowTraceSettingsModal(true);
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
        visible={valueModalStep !== null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setValueModalStep(null);
          setValueModalError(null);
          setGuidedStep('idle');
          setMode('idle');
        }}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.valueModalCard}>
            <Text style={styles.valueModalTitle}>
              {valueModalStep === 'x0'
                ? 'x0 values'
                : valueModalStep === 'yRef'
                  ? 'Known Y value'
                  : 'x1 values'}
            </Text>
            <Text style={styles.valueModalHint}>
              {valueModalStep === 'x0'
                ? 'Enter the start date/time and stage value for x0.'
                : valueModalStep === 'yRef'
                  ? 'Enter the known stage value at the selected Y reference point.'
                  : 'Enter the end date/time and stage value for x1.'}
            </Text>

            {valueModalStep === 'x0' || valueModalStep === 'x1' ? (
              <>
                <Text style={styles.valueLabel}>Date and time</Text>
                {Platform.OS === 'web' ? (
                  <View style={styles.dateTimePickerRow}>
                    <View style={styles.dateTimePickerCol}>
                      <Text style={styles.dateTimePickerLabel}>Date</Text>
                      <input
                        type="date"
                        value={valueModalStep === 'x0' ? x0DatePartDraft : x1DatePartDraft}
                        onChange={(event) => {
                          const nextDate = normalizeDatePart(event.target.value);
                          if (valueModalStep === 'x0') setX0DatePartDraft(nextDate);
                          else setX1DatePartDraft(nextDate);
                        }}
                        style={WEB_DATE_TIME_INPUT_STYLE}
                      />
                    </View>
                    <View style={styles.dateTimePickerCol}>
                      <Text style={styles.dateTimePickerLabel}>Time</Text>
                      <input
                        type="time"
                        value={valueModalStep === 'x0' ? x0TimePartDraft : x1TimePartDraft}
                        step={60}
                        onChange={(event) => {
                          const nextTime = normalizeTimePart(event.target.value);
                          if (valueModalStep === 'x0') setX0TimePartDraft(nextTime);
                          else setX1TimePartDraft(nextTime);
                        }}
                        style={WEB_DATE_TIME_INPUT_STYLE}
                      />
                    </View>
                  </View>
                ) : (
                  <View style={styles.dateTimePickerRow}>
                    <View style={styles.dateTimePickerCol}>
                      <Text style={styles.dateTimePickerLabel}>Date (YYYY-MM-DD or MM/DD/YYYY)</Text>
                      <TextInput
                        style={styles.valueInput}
                        value={valueModalStep === 'x0' ? x0DatePartDraft : x1DatePartDraft}
                        onChangeText={valueModalStep === 'x0' ? setX0DatePartDraft : setX1DatePartDraft}
                        autoCapitalize="none"
                        autoCorrect={false}
                        placeholder={valueModalStep === 'x0' ? '2026-03-13' : '2026-03-20'}
                        placeholderTextColor={Colors.textMuted}
                      />
                    </View>
                    <View style={styles.dateTimePickerCol}>
                      <Text style={styles.dateTimePickerLabel}>Time (HH:mm)</Text>
                      <TextInput
                        style={styles.valueInput}
                        value={valueModalStep === 'x0' ? x0TimePartDraft : x1TimePartDraft}
                        onChangeText={valueModalStep === 'x0' ? setX0TimePartDraft : setX1TimePartDraft}
                        autoCapitalize="none"
                        autoCorrect={false}
                        placeholder="00:00"
                        placeholderTextColor={Colors.textMuted}
                      />
                    </View>
                  </View>
                )}
              </>
            ) : null}

            <Text style={styles.valueLabel}>Stage (ft)</Text>
            <TextInput
              style={styles.valueInput}
              value={valueModalStep === 'x0' ? x0StageDraft : valueModalStep === 'yRef' ? yRefStageDraft : x1StageDraft}
              onChangeText={valueModalStep === 'x0' ? setX0StageDraft : valueModalStep === 'yRef' ? setYRefStageDraft : setX1StageDraft}
              keyboardType="decimal-pad"
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="e.g. 2.50"
              placeholderTextColor={Colors.textMuted}
            />

            {valueModalError ? <Text style={styles.valueModalError}>{valueModalError}</Text> : null}

            <View style={styles.valueModalActions}>
              <TouchableOpacity
                style={styles.valueCancelBtn}
                onPress={() => {
                  setValueModalStep(null);
                  setValueModalError(null);
                  setGuidedStep('idle');
                  setMode('idle');
                }}
              >
                <Text style={styles.valueCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.valueSaveBtn} onPress={() => void handleValueModalContinue()}>
                <Text style={styles.valueSaveText}>{valueModalStep === 'x1' ? 'Apply + Trace' : 'Continue'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showTraceSettingsModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowTraceSettingsModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.valueModalCard}>
            <Text style={styles.valueModalTitle}>Trace Color Settings</Text>
            <Text style={styles.valueModalHint}>
              Save pencil and grid colors once, then auto-trace will reuse them for future sessions.
            </Text>

            <Text style={styles.valueLabel}>Pencil color (hex)</Text>
            <View style={styles.colorRow}>
              <View style={[styles.colorPreview, { backgroundColor: traceSettings.pencilColor }]} />
              <TextInput
                style={[styles.valueInput, styles.colorInput]}
                value={traceSettings.pencilColor}
                onChangeText={(value) => setTraceSettings((prev) => ({ ...prev, pencilColor: value }))}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="#6d6d6d"
                placeholderTextColor={Colors.textMuted}
              />
              <TouchableOpacity style={styles.sampleBtn} onPress={() => beginColorSampling('pencil')}>
                <Text style={styles.sampleBtnText}>Sample</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.valueLabel}>Grid color (hex)</Text>
            <View style={styles.colorRow}>
              <View style={[styles.colorPreview, { backgroundColor: traceSettings.gridColor }]} />
              <TextInput
                style={[styles.valueInput, styles.colorInput]}
                value={traceSettings.gridColor}
                onChangeText={(value) => setTraceSettings((prev) => ({ ...prev, gridColor: value }))}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="#3e9bd1"
                placeholderTextColor={Colors.textMuted}
              />
              <TouchableOpacity style={styles.sampleBtn} onPress={() => beginColorSampling('grid')}>
                <Text style={styles.sampleBtnText}>Sample</Text>
              </TouchableOpacity>
            </View>

            {traceSettingsError ? <Text style={styles.valueModalError}>{traceSettingsError}</Text> : null}

            <View style={styles.valueModalActions}>
              <TouchableOpacity
                style={styles.valueCancelBtn}
                onPress={() => setShowTraceSettingsModal(false)}
              >
                <Text style={styles.valueCancelText}>Close</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.valueSaveBtn} onPress={() => void handleSaveTraceSettings()}>
                <Text style={styles.valueSaveText}>Save Colors</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

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
  mobileBlockTitle: {
    color: Colors.text,
    fontSize: FontSize.xl,
    fontWeight: '700',
    marginBottom: Spacing.sm,
  },
  mobileBlockBody: {
    color: Colors.textMuted,
    fontSize: FontSize.md,
    textAlign: 'center',
    maxWidth: 420,
    marginBottom: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  mobileBlockBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: 10,
  },
  mobileBlockBtnText: {
    color: '#fff',
    fontSize: FontSize.md,
    fontWeight: '700',
  },
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
  valueModalCard: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  valueModalTitle: {
    color: Colors.text,
    fontSize: FontSize.lg,
    fontWeight: '700',
  },
  valueModalHint: {
    color: Colors.textMuted,
    fontSize: FontSize.sm,
    marginBottom: 2,
  },
  valueLabel: {
    color: Colors.textSecondary,
    fontSize: FontSize.xs,
  },
  valueInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: FontSize.md,
    color: Colors.text,
    backgroundColor: Colors.surfaceDim,
  },
  colorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: 4,
  },
  colorPreview: {
    width: 30,
    height: 30,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  colorInput: {
    flex: 1,
  },
  sampleBtn: {
    backgroundColor: Colors.primaryLight,
    borderRadius: 8,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 8,
  },
  sampleBtnText: {
    color: '#fff',
    fontSize: FontSize.sm,
    fontWeight: '700',
  },
  dateTimePickerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    marginBottom: 2,
  },
  dateTimePickerCol: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  dateTimePickerLabel: {
    color: Colors.textSecondary,
    fontSize: FontSize.xs,
  },
  valueModalError: {
    color: Colors.error,
    fontSize: FontSize.sm,
  },
  valueModalActions: {
    marginTop: Spacing.xs,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.xs,
  },
  valueCancelBtn: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  valueCancelText: {
    color: Colors.text,
    fontSize: FontSize.sm,
    fontWeight: '600',
  },
  valueSaveBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 8,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  valueSaveText: {
    color: '#fff',
    fontSize: FontSize.sm,
    fontWeight: '700',
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
