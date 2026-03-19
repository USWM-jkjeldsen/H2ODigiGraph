import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Image,
  StyleSheet,
  GestureResponderEvent,
  LayoutChangeEvent,
  PanResponder,
  Text,
  Platform,
} from 'react-native';
import Svg, { Line, Circle, Polyline, Rect } from 'react-native-svg';
import type { DigiPoint, GraphBounds } from '../lib/types';
import { pixelToReal } from '../lib/digitizer';
import { Colors, FontSize } from '../lib/theme';

export type CanvasMode =
  | 'idle'
  | 'setBoxStart'
  | 'setBoxEnd'
  | 'setCalXStart'
  | 'setCalXEnd'
  | 'setCalYRef'
  | 'pickPencilColor'
  | 'pickGridColor'
  | 'digitize';
export type CalibrationPointKey = 'xStart' | 'xEnd' | 'yRef';

/**
 * Step-by-step instruction shown in the canvas badge for each bounds mode.
 */
const STEP_LABEL: Partial<Record<CanvasMode, string>> = {
  setBoxStart: 'Step 1 / 2  —  Click-drag box (web) or tap bottom-left corner',
  setBoxEnd: 'Step 2 / 2  —  Release drag (web) or tap top-right corner',
  setCalXStart: 'Calibration 1 / 3  —  tap x0 start point on the line',
  setCalYRef: 'Calibration 2 / 3  —  tap a point with known Y value',
  setCalXEnd: 'Calibration 3 / 3  —  tap x1 end point on the line',
  pickPencilColor: 'Tap a pencil/trace pixel to sample its color',
  pickGridColor: 'Tap a gridline pixel to sample its color',
  digitize: 'Tap to add  •  Drag point to reposition  •  Tap point to remove',
};

const DIGITIZE_HIT_RADIUS_PX = 12;
const DIGITIZE_ADD_MIN_SPACING_PX = 10;

interface Props {
  imageUri: string;
  mode: CanvasMode;
  bounds?: GraphBounds;
  points: DigiPoint[];
  extractedLine?: { x: number; y: number }[];
  pendingBoxStart?: { x: number; y: number } | null;
  pendingBoxEnd?: { x: number; y: number } | null;
  onCanvasSizeChange?: (size: { width: number; height: number }) => void;
  onImageFrameChange?: (frame: { x: number; y: number; width: number; height: number }) => void;
  onBoxStartSet?: (px: { x: number; y: number }) => void;
  onBoxEndSet?: (px: { x: number; y: number }) => void;
  calibrationPoints?: Partial<Record<CalibrationPointKey, { x: number; y: number }>>;
  onCalibrationPointSet?: (key: CalibrationPointKey, px: { x: number; y: number }) => void;
  onPointAdded?: (point: DigiPoint) => void;
  onPointRemoved?: (index: number) => void;
  onPointMoved?: (index: number, point: DigiPoint) => void;
  onTraceColorSampled?: (target: 'pencil' | 'grid', hex: string) => void;
}

export function GraphCanvas({
  imageUri,
  mode,
  bounds,
  points,
  extractedLine,
  pendingBoxStart,
  pendingBoxEnd,
  onCanvasSizeChange,
  onImageFrameChange,
  onBoxStartSet,
  onBoxEndSet,
  calibrationPoints,
  onCalibrationPointSet,
  onPointAdded,
  onPointRemoved,
  onPointMoved,
  onTraceColorSampled,
}: Props) {
  const [imgDim, setImgDim] = useState({ width: 1, height: 1 });
  const [sourceSize, setSourceSize] = useState<{ width: number; height: number } | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);
  const [draggingPointIndex, setDraggingPointIndex] = useState<number | null>(null);
  const [draggingPx, setDraggingPx] = useState<{ x: number; y: number } | null>(null);
  const [zoomFocus, setZoomFocus] = useState<{ x: number; y: number } | null>(null);
  const [zoomActive, setZoomActive] = useState(false);
  const zoomDelayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ZOOM_HOLD_DELAY_MS = 120;

  const isZoomMode =
    mode === 'setCalXStart'
    || mode === 'setCalXEnd'
    || mode === 'setCalYRef'
    || mode === 'pickPencilColor'
    || mode === 'pickGridColor';

  const clearZoomDelay = useCallback(() => {
    if (zoomDelayTimerRef.current) {
      clearTimeout(zoomDelayTimerRef.current);
      zoomDelayTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isZoomMode) {
      clearZoomDelay();
      setZoomActive(false);
      setZoomFocus(null);
    }
  }, [clearZoomDelay, isZoomMode]);

  useEffect(() => {
    return () => {
      clearZoomDelay();
    };
  }, [clearZoomDelay]);

  useEffect(() => {
    let cancelled = false;
    Image.getSize(
      imageUri,
      (width, height) => {
        if (!cancelled) {
          setSourceSize({ width, height });
        }
      },
      () => {
        if (!cancelled) {
          setSourceSize(null);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [imageUri]);

  const imageFrame = useMemo(() => {
    if (!sourceSize || imgDim.width <= 1 || imgDim.height <= 1) {
      return { x: 0, y: 0, width: imgDim.width, height: imgDim.height };
    }
    const scale = Math.min(imgDim.width / sourceSize.width, imgDim.height / sourceSize.height);
    const width = sourceSize.width * scale;
    const height = sourceSize.height * scale;
    const x = (imgDim.width - width) / 2;
    const y = (imgDim.height - height) / 2;
    return { x, y, width, height };
  }, [imgDim.height, imgDim.width, sourceSize]);

  useEffect(() => {
    if (imageFrame.width > 1 && imageFrame.height > 1) {
      onImageFrameChange?.(imageFrame);
    }
  }, [imageFrame, onImageFrameChange]);

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setImgDim({ width, height });
    onCanvasSizeChange?.({ width, height });
  }, [onCanvasSizeChange]);

  const clampPoint = useCallback(
    (x: number, y: number) => ({
      x: Math.max(0, Math.min(imgDim.width, x)),
      y: Math.max(0, Math.min(imgDim.height, y)),
    }),
    [imgDim.height, imgDim.width],
  );

  const isFinitePoint = (p: { x: number; y: number } | null | undefined): p is { x: number; y: number } =>
    !!p && Number.isFinite(p.x) && Number.isFinite(p.y);

  const getEventPoint = useCallback(
    (e: GestureResponderEvent) => clampPoint(e.nativeEvent.locationX, e.nativeEvent.locationY),
    [clampPoint],
  );

  const sampleColorAtCanvasPoint = useCallback(async (px: { x: number; y: number }): Promise<string | null> => {
    if (Platform.OS !== 'web' || typeof document === 'undefined' || !sourceSize) {
      return null;
    }
    if (
      px.x < imageFrame.x
      || px.x > imageFrame.x + imageFrame.width
      || px.y < imageFrame.y
      || px.y > imageFrame.y + imageFrame.height
    ) {
      return null;
    }

    const normX = (px.x - imageFrame.x) / Math.max(1, imageFrame.width);
    const normY = (px.y - imageFrame.y) / Math.max(1, imageFrame.height);
    const srcX = Math.max(0, Math.min(sourceSize.width - 1, Math.round(normX * sourceSize.width)));
    const srcY = Math.max(0, Math.min(sourceSize.height - 1, Math.round(normY * sourceSize.height)));

    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new window.Image();
      element.crossOrigin = 'anonymous';
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('Failed to load image for color sampling.'));
      element.src = imageUri;
    });

    const canvas = document.createElement('canvas');
    canvas.width = sourceSize.width;
    canvas.height = sourceSize.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, sourceSize.width, sourceSize.height);

    const radius = 2;
    const left = Math.max(0, srcX - radius);
    const top = Math.max(0, srcY - radius);
    const width = Math.min(sourceSize.width - left, radius * 2 + 1);
    const height = Math.min(sourceSize.height - top, radius * 2 + 1);
    const data = ctx.getImageData(left, top, width, height).data;

    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      if (alpha === 0) continue;
      sumR += data[i];
      sumG += data[i + 1];
      sumB += data[i + 2];
      count += 1;
    }
    if (count === 0) return null;

    const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    return `#${toHex(sumR / count)}${toHex(sumG / count)}${toHex(sumB / count)}`;
  }, [imageFrame.height, imageFrame.width, imageFrame.x, imageFrame.y, imageUri, sourceSize]);

  const commitDigitizePoint = useCallback(
    (px: { x: number; y: number }) => {
      if (mode !== 'digitize' || !bounds) return;
      if (
        px.x < imageFrame.x ||
        px.x > imageFrame.x + imageFrame.width ||
        px.y < imageFrame.y ||
        px.y > imageFrame.y + imageFrame.height
      ) {
        return;
      }
      const { realX, realY } = pixelToReal(px, bounds, imgDim);
      if (!Number.isFinite(realX) || !Number.isFinite(realY)) return;
      onPointAdded?.({ px, realX, realY });
    },
    [mode, bounds, imgDim, onPointAdded, imageFrame],
  );

  const commitBox = useCallback(
    (startPx: { x: number; y: number }, endPx: { x: number; y: number }) => {
      onBoxStartSet?.(startPx);
      onBoxEndSet?.(endPx);
      setDragStart(null);
      setDragCurrent(null);
    },
    [onBoxStartSet, onBoxEndSet],
  );

  const handleResponderGrant = useCallback(
    (e: GestureResponderEvent) => {
      const px = getEventPoint(e);
      if (isZoomMode) {
        clearZoomDelay();
        setZoomActive(false);
        setZoomFocus(px);
        zoomDelayTimerRef.current = setTimeout(() => {
          setZoomActive(true);
        }, ZOOM_HOLD_DELAY_MS);
      }

      if (mode === 'setBoxStart' || mode === 'setBoxEnd') {
        setDragStart(px);
        setDragCurrent(px);
        return;
      }
      if (mode === 'digitize') {
        let hitIdx = -1;
        let bestDist = Number.POSITIVE_INFINITY;
        for (let i = 0; i < points.length; i++) {
          const dist = Math.hypot(points[i].px.x - px.x, points[i].px.y - px.y);
          if (dist <= DIGITIZE_HIT_RADIUS_PX && dist < bestDist) {
            bestDist = dist;
            hitIdx = i;
          }
        }
        if (hitIdx !== -1) {
          setDraggingPointIndex(hitIdx);
          setDraggingPx(points[hitIdx].px);
        }
      }
    },
    [clearZoomDelay, mode, getEventPoint, isZoomMode, points],
  );

  const handleResponderMove = useCallback(
    (e: GestureResponderEvent) => {
      if (isZoomMode && zoomActive) {
        setZoomFocus(getEventPoint(e));
      }
      if (mode === 'setBoxStart' || mode === 'setBoxEnd') {
        if (!dragStart) return;
        setDragCurrent(getEventPoint(e));
        return;
      }
      if (mode === 'digitize' && draggingPointIndex !== null) {
        setDraggingPx(getEventPoint(e));
      }
    },
    [mode, dragStart, draggingPointIndex, getEventPoint, isZoomMode, zoomActive],
  );

  const handleResponderRelease = useCallback(
    async (e: GestureResponderEvent) => {
      const releasePx = getEventPoint(e);
      if (isZoomMode && zoomActive) {
        setZoomFocus(releasePx);
      }

      try {
        if (mode === 'pickPencilColor' || mode === 'pickGridColor') {
          try {
            const sampled = await sampleColorAtCanvasPoint(releasePx);
            if (sampled) {
              onTraceColorSampled?.(mode === 'pickPencilColor' ? 'pencil' : 'grid', sampled);
            }
          } catch (err) {
            console.warn('Color sampling failed', err);
          }
          return;
        }

        if (mode === 'setBoxStart' || mode === 'setBoxEnd') {
          const px = releasePx;
          const startPx = dragStart ?? px;
          const endPx = dragCurrent ?? px;
          const dragged = Math.abs(endPx.x - startPx.x) > 3 || Math.abs(endPx.y - startPx.y) > 3;

          if (dragged) {
            commitBox(startPx, endPx);
            return;
          }

          // Tap flow fallback for mobile and desktop click without dragging.
          if (mode === 'setBoxStart') {
            onBoxStartSet?.(px);
          } else {
            onBoxEndSet?.(px);
          }
          setDragStart(null);
          setDragCurrent(null);
          return;
        }

        if (mode === 'setCalXStart' || mode === 'setCalXEnd' || mode === 'setCalYRef') {
          const px = releasePx;
          const target: CalibrationPointKey =
            mode === 'setCalXStart' ? 'xStart' : mode === 'setCalXEnd' ? 'xEnd' : 'yRef';
          onCalibrationPointSet?.(target, px);
          return;
        }

        if (mode === 'digitize') {
          // Finish interacting with an existing point.
          if (draggingPointIndex !== null) {
            const finalPx = draggingPx ?? getEventPoint(e);
            const moved = Math.hypot(
              finalPx.x - points[draggingPointIndex].px.x,
              finalPx.y - points[draggingPointIndex].px.y,
            );
            if (moved > 4) {
              // Drag → reposition (parent will locally retrace the segment).
              if (bounds) {
                const { realX, realY } = pixelToReal(finalPx, bounds, imgDim);
                if (Number.isFinite(realX) && Number.isFinite(realY)) {
                  onPointMoved?.(draggingPointIndex, { px: finalPx, realX, realY });
                }
              }
            } else {
              // Tap without drag → delete the point.
              onPointRemoved?.(draggingPointIndex);
            }
            setDraggingPointIndex(null);
            setDraggingPx(null);
            return;
          }
          // No existing point hit → add new point only when not too close to neighbors.
          const nearestDist = points.reduce((best, point) => {
            const dist = Math.hypot(point.px.x - releasePx.x, point.px.y - releasePx.y);
            return Math.min(best, dist);
          }, Number.POSITIVE_INFINITY);
          if (nearestDist >= DIGITIZE_ADD_MIN_SPACING_PX) {
            commitDigitizePoint(releasePx);
          }
        }
      } finally {
        clearZoomDelay();
        setZoomActive(false);
        setZoomFocus(null);
      }
    },
    [clearZoomDelay, mode, getEventPoint, isZoomMode, zoomActive, sampleColorAtCanvasPoint, onTraceColorSampled, dragStart, dragCurrent, commitBox, onBoxStartSet, onBoxEndSet, onCalibrationPointSet, draggingPointIndex, draggingPx, points, bounds, imgDim, onPointMoved, onPointRemoved, commitDigitizePoint],
  );

  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => mode !== 'idle',
    onMoveShouldSetPanResponder: () => mode !== 'idle',
    onPanResponderGrant: handleResponderGrant,
    onPanResponderMove: handleResponderMove,
    onPanResponderRelease: handleResponderRelease,
    onPanResponderTerminationRequest: () => false,
    onPanResponderTerminate: handleResponderRelease,
  });

  // Resolve graph box corners: active drag first, then pending taps, then saved bounds.
  const start =
    dragStart ??
    pendingBoxStart ??
    (bounds && Number.isFinite(bounds.originPx.x) && Number.isFinite(bounds.originPx.y)
      ? { x: bounds.originPx.x, y: bounds.originPx.y }
      : null);
  const end =
    dragCurrent ??
    pendingBoxEnd ??
    (bounds && Number.isFinite(bounds.farPx.x) && Number.isFinite(bounds.farPx.y)
      ? { x: bounds.farPx.x, y: bounds.farPx.y }
      : null);

  const { width: W, height: H } = imgDim;

  const left = isFinitePoint(start) && isFinitePoint(end) ? Math.min(start.x, end.x) : null;
  const right = isFinitePoint(start) && isFinitePoint(end) ? Math.max(start.x, end.x) : null;
  const top = isFinitePoint(start) && isFinitePoint(end) ? Math.min(start.y, end.y) : null;
  const bottom = isFinitePoint(start) && isFinitePoint(end) ? Math.max(start.y, end.y) : null;

  const polylinePoints = points
    .slice()
    .sort((a, b) => a.px.x - b.px.x)
    .map((p) => `${p.px.x},${p.px.y}`)
    .join(' ');

  const extractedPolylinePoints = (extractedLine && extractedLine.length > 1
    ? extractedLine
    : points
        .slice()
        .sort((a, b) => a.px.x - b.px.x)
        .map((p, i, arr) => {
          const prev = arr[Math.max(0, i - 1)].px;
          const next = arr[Math.min(arr.length - 1, i + 1)].px;
          return { x: p.px.x, y: (prev.y + p.px.y + next.y) / 3 };
        })
  )
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => `${p.x},${p.y}`)
    .join(' ');

  const instructionLabel = STEP_LABEL[mode];
  const showZoomBubble = isZoomMode && zoomActive;
  const bubbleSize = 150;
  const bubbleScale = 3;
  const focus = zoomFocus;
  const bubbleLeft = focus ? Math.max(8, Math.min(W - bubbleSize - 8, focus.x + 16)) : 8;
  const bubbleTop = focus ? Math.max(8, Math.min(H - bubbleSize - 8, focus.y - bubbleSize - 16)) : 8;
  const zoomedW = W * bubbleScale;
  const zoomedH = H * bubbleScale;
  const zoomedLeft = focus ? bubbleSize / 2 - focus.x * bubbleScale : 0;
  const zoomedTop = focus ? bubbleSize / 2 - focus.y * bubbleScale : 0;

  return (
    <View
      style={styles.container}
      {...panResponder.panHandlers}
      onPointerMove={(evt) => {
        if (!showZoomBubble) return;
        const native = evt.nativeEvent as unknown as { locationX?: number; locationY?: number };
        if (native.locationX == null || native.locationY == null) return;
        setZoomFocus(clampPoint(native.locationX, native.locationY));
      }}
      onPointerLeave={() => {
        if (showZoomBubble) {
          clearZoomDelay();
          setZoomActive(false);
          setZoomFocus(null);
        }
      }}
    >
        <Image
          source={{ uri: imageUri }}
          style={StyleSheet.absoluteFill}
          resizeMode="contain"
          onLayout={handleLayout}
        />
        <Svg style={StyleSheet.absoluteFill} width={W} height={H}>

          {/* First corner marker while selecting graph box */}
          {isFinitePoint(start) && !isFinitePoint(end) ? (
            <Circle
              cx={start.x}
              cy={start.y}
              r={7}
              fill={Colors.boundaryOrigin}
              stroke="#fff"
              strokeWidth={2}
            />
          ) : null}

          {/* Graph bounding rectangle */}
          {left != null && right != null && top != null && bottom != null ? (
            <>
              <Rect
                x={left}
                y={top}
                width={right - left}
                height={bottom - top}
                fill="rgba(52,152,219,0.08)"
                stroke={Colors.boundaryFar}
                strokeWidth={2}
                strokeDasharray="8 4"
              />
              <Line x1={left} y1={bottom} x2={right} y2={bottom} stroke={Colors.warning} strokeWidth={2} strokeDasharray="6 3" />
              <Line x1={left} y1={top} x2={right} y2={top} stroke={Colors.accent} strokeWidth={2} strokeDasharray="6 3" />
              <Line x1={left} y1={top} x2={left} y2={bottom} stroke={Colors.boundaryOrigin} strokeWidth={2} strokeDasharray="6 3" />
              <Line x1={right} y1={top} x2={right} y2={bottom} stroke={Colors.boundaryFar} strokeWidth={2} strokeDasharray="6 3" />
            </>
          ) : null}

          {/* ── Digitised curve ── */}
          {points.length > 1 ? (
            <Polyline
              points={polylinePoints}
              fill="none"
              stroke={Colors.digitLine}
              strokeWidth={2.5}
            />
          ) : null}

          {/* Final extracted line (AI-style smoothed preview) */}
          {extractedPolylinePoints ? (
            <Polyline
              points={extractedPolylinePoints}
              fill="none"
              stroke={Colors.accent}
              strokeWidth={3}
              strokeDasharray="2 0"
              opacity={0.85}
            />
          ) : null}

          {/* ── Individual digitised points (tap to remove, drag to reposition) ── */}
          {points.map((p, i) => {
            const isBeingDragged = i === draggingPointIndex;
            const cx = isBeingDragged && draggingPx ? draggingPx.x : p.px.x;
            const cy = isBeingDragged && draggingPx ? draggingPx.y : p.px.y;
            return (
              <Circle
                key={i}
                cx={cx}
                cy={cy}
                r={isBeingDragged ? 10 : 6}
                fill={isBeingDragged ? Colors.accent : Colors.digitPoint}
                stroke="#fff"
                strokeWidth={2}
                onPress={undefined}
              />
            );
          })}

          {calibrationPoints?.xStart ? (
            <Circle
              cx={calibrationPoints.xStart.x}
              cy={calibrationPoints.xStart.y}
              r={7}
              fill={Colors.warning}
              stroke="#fff"
              strokeWidth={2}
            />
          ) : null}
          {calibrationPoints?.xEnd ? (
            <Circle
              cx={calibrationPoints.xEnd.x}
              cy={calibrationPoints.xEnd.y}
              r={7}
              fill={Colors.accent}
              stroke="#fff"
              strokeWidth={2}
            />
          ) : null}
          {calibrationPoints?.yRef ? (
            <Circle
              cx={calibrationPoints.yRef.x}
              cy={calibrationPoints.yRef.y}
              r={7}
              fill={Colors.success}
              stroke="#fff"
              strokeWidth={2}
            />
          ) : null}
        </Svg>

        {/* Step instruction badge */}
        {instructionLabel ? (
          <View style={styles.modeBadge}>
            <Text style={styles.modeText}>{instructionLabel}</Text>
          </View>
        ) : null}

        {showZoomBubble && focus ? (
          <View style={[styles.zoomBubble, { left: bubbleLeft, top: bubbleTop, width: bubbleSize, height: bubbleSize, borderRadius: bubbleSize / 2 }]}>
            <Image
              source={{ uri: imageUri }}
              style={{
                position: 'absolute',
                width: zoomedW,
                height: zoomedH,
                left: zoomedLeft,
                top: zoomedTop,
              }}
              resizeMode="contain"
            />
            <View style={styles.zoomCrosshairVertical} />
            <View style={styles.zoomCrosshairHorizontal} />
          </View>
        ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  modeBadge: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    right: 12,
    backgroundColor: 'rgba(0,0,0,0.70)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  modeText: {
    color: '#fff',
    fontSize: FontSize.sm,
    textAlign: 'center',
  },
  zoomBubble: {
    position: 'absolute',
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.9)',
    backgroundColor: '#000',
    zIndex: 20,
  },
  zoomCrosshairVertical: {
    position: 'absolute',
    left: '50%',
    top: 0,
    bottom: 0,
    width: 1,
    marginLeft: -0.5,
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  zoomCrosshairHorizontal: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    height: 1,
    marginTop: -0.5,
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
});
