import React, { useRef, useState, useCallback } from 'react';
import {
  View,
  Image,
  StyleSheet,
  TouchableWithoutFeedback,
  GestureResponderEvent,
  LayoutChangeEvent,
  Text,
} from 'react-native';
import Svg, { Line, Circle, Polyline } from 'react-native-svg';
import type { DigiPoint, GraphBounds } from '../lib/types';
import { pixelToReal } from '../lib/digitizer';
import { Colors } from '../lib/theme';

export type CanvasMode = 'idle' | 'setOrigin' | 'setFar' | 'digitize';

interface Props {
  imageUri: string;
  mode: CanvasMode;
  bounds?: GraphBounds;
  points: DigiPoint[];
  onOriginSet?: (px: { x: number; y: number }) => void;
  onFarSet?: (px: { x: number; y: number }) => void;
  onPointAdded?: (point: DigiPoint) => void;
  onPointRemoved?: (index: number) => void;
}

export function GraphCanvas({
  imageUri,
  mode,
  bounds,
  points,
  onOriginSet,
  onFarSet,
  onPointAdded,
  onPointRemoved,
}: Props) {
  const [imgDim, setImgDim] = useState({ width: 1, height: 1 });

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setImgDim({ width, height });
  }, []);

  const handlePress = useCallback(
    (e: GestureResponderEvent) => {
      const { locationX, locationY } = e.nativeEvent;
      const px = { x: locationX, y: locationY };

      if (mode === 'setOrigin') {
        onOriginSet?.(px);
        return;
      }
      if (mode === 'setFar') {
        onFarSet?.(px);
        return;
      }
      if (mode === 'digitize' && bounds) {
        const { realX, realY } = pixelToReal(px, bounds, imgDim);
        onPointAdded?.({ px, realX, realY });
      }
    },
    [mode, bounds, imgDim, onOriginSet, onFarSet, onPointAdded],
  );

  const polylinePoints = points
    .slice()
    .sort((a, b) => a.px.x - b.px.x)
    .map((p) => `${p.px.x},${p.px.y}`)
    .join(' ');

  const hasOrigin = bounds?.originPx != null;
  const hasFar = bounds?.farPx != null;

  return (
    <TouchableWithoutFeedback onPress={handlePress}>
      <View style={styles.container}>
        <Image
          source={{ uri: imageUri }}
          style={StyleSheet.absoluteFill}
          resizeMode="contain"
          onLayout={handleLayout}
        />
        <Svg style={StyleSheet.absoluteFill} width={imgDim.width} height={imgDim.height}>
          {/* Boundary lines */}
          {hasOrigin && hasFar ? (
            <>
              {/* Vertical left axis line */}
              <Line
                x1={bounds!.originPx.x}
                y1={bounds!.originPx.y}
                x2={bounds!.originPx.x}
                y2={bounds!.farPx.y}
                stroke={Colors.boundaryOrigin}
                strokeWidth={2}
                strokeDasharray="6 3"
              />
              {/* Horizontal bottom axis line */}
              <Line
                x1={bounds!.originPx.x}
                y1={bounds!.originPx.y}
                x2={bounds!.farPx.x}
                y2={bounds!.originPx.y}
                stroke={Colors.boundaryOrigin}
                strokeWidth={2}
                strokeDasharray="6 3"
              />
              {/* Far corner cross */}
              <Line
                x1={bounds!.farPx.x - 8}
                y1={bounds!.farPx.y}
                x2={bounds!.farPx.x + 8}
                y2={bounds!.farPx.y}
                stroke={Colors.boundaryFar}
                strokeWidth={2}
              />
              <Line
                x1={bounds!.farPx.x}
                y1={bounds!.farPx.y - 8}
                x2={bounds!.farPx.x}
                y2={bounds!.farPx.y + 8}
                stroke={Colors.boundaryFar}
                strokeWidth={2}
              />
            </>
          ) : null}

          {/* Boundary origin marker */}
          {hasOrigin ? (
            <Circle
              cx={bounds!.originPx.x}
              cy={bounds!.originPx.y}
              r={7}
              fill={Colors.boundaryOrigin}
              stroke="#fff"
              strokeWidth={2}
            />
          ) : null}

          {/* Digitised curve polyline */}
          {points.length > 1 ? (
            <Polyline
              points={polylinePoints}
              fill="none"
              stroke={Colors.digitLine}
              strokeWidth={2.5}
            />
          ) : null}

          {/* Individual digitised points */}
          {points.map((p, i) => (
            <Circle
              key={i}
              cx={p.px.x}
              cy={p.px.y}
              r={6}
              fill={Colors.digitPoint}
              stroke="#fff"
              strokeWidth={2}
              onPress={() => onPointRemoved?.(i)}
            />
          ))}
        </Svg>

        {/* Mode label overlay */}
        {mode !== 'idle' ? (
          <View style={styles.modeBadge}>
            <Text style={styles.modeText}>
              {mode === 'setOrigin'
                ? 'Tap bottom-left chart corner (X min, Y min)'
                : mode === 'setFar'
                  ? 'Tap top-right chart corner (X max, Y max)'
                  : 'Tap the curve to add points • tap a point to remove'}
            </Text>
          </View>
        ) : null}
      </View>
    </TouchableWithoutFeedback>
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
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  modeText: {
    color: '#fff',
    fontSize: 12,
    textAlign: 'center',
  },
});
