import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Image,
  StyleSheet,
  GestureResponderEvent,
  LayoutChangeEvent,
  PanResponder,
  Text,
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
  | 'digitize';
export type CalibrationPointKey = 'xStart' | 'xEnd' | 'yRef';

/**
 * Step-by-step instruction shown in the canvas badge for each bounds mode.
 */
const STEP_LABEL: Partial<Record<CanvasMode, string>> = {
  setBoxStart: 'Step 1 / 2  —  Click-drag box (web) or tap bottom-left corner',
  setBoxEnd: 'Step 2 / 2  —  Release drag (web) or tap top-right corner',
  setCalXStart: 'Advanced calibration: tap chart point for known X start time',
  setCalXEnd: 'Advanced calibration: tap chart point for known X end time',
  setCalYRef: 'Advanced calibration: tap chart point for known Y value',
  digitize: 'Tap to add  •  Drag point to reposition  •  Tap point to remove',
};

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
}: Props) {
  const [imgDim, setImgDim] = useState({ width: 1, height: 1 });
  const [sourceSize, setSourceSize] = useState<{ width: number; height: number } | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);
  const [draggingPointIndex, setDraggingPointIndex] = useState<number | null>(null);
  const [draggingPx, setDraggingPx] = useState<{ x: number; y: number } | null>(null);

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

      if (mode === 'setBoxStart' || mode === 'setBoxEnd') {
        setDragStart(px);
        setDragCurrent(px);
        return;
      }
      if (mode === 'digitize') {
        const HIT_RADIUS = 16;
        const hitIdx = points.findIndex(
          (p) => Math.hypot(p.px.x - px.x, p.px.y - px.y) < HIT_RADIUS,
        );
        if (hitIdx !== -1) {
          setDraggingPointIndex(hitIdx);
          setDraggingPx(points[hitIdx].px);
        }
      }
    },
    [mode, getEventPoint, points],
  );

  const handleResponderMove = useCallback(
    (e: GestureResponderEvent) => {
      if (mode === 'setBoxStart' || mode === 'setBoxEnd') {
        if (!dragStart) return;
        setDragCurrent(getEventPoint(e));
        return;
      }
      if (mode === 'digitize' && draggingPointIndex !== null) {
        setDraggingPx(getEventPoint(e));
      }
    },
    [mode, dragStart, draggingPointIndex, getEventPoint],
  );

  const handleResponderRelease = useCallback(
    (e: GestureResponderEvent) => {
      if (mode === 'setBoxStart' || mode === 'setBoxEnd') {
        const px = getEventPoint(e);
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
        const px = getEventPoint(e);
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
        // No existing point hit → add new point.
        commitDigitizePoint(getEventPoint(e));
      }
    },
    [mode, dragStart, dragCurrent, draggingPointIndex, draggingPx, getEventPoint, commitBox, onBoxStartSet, onBoxEndSet, onCalibrationPointSet, commitDigitizePoint, bounds, imgDim, points, onPointMoved],
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

  return (
    <View style={styles.container} {...panResponder.panHandlers}>
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
});
