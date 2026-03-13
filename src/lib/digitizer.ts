import type { DigiPoint, GraphBounds, DailyRecord } from './types';

/**
 * Convert a pixel coordinate on the displayed image to a real-world (X, Y)
 * value using the user-defined graph bounds.
 *
 * @param px      - Pixel position tapped on the image
 * @param bounds  - User-defined boundary mapping
 * @param imgDim  - Rendered image size in pixels {width, height}
 */
export function pixelToReal(
  px: { x: number; y: number },
  bounds: GraphBounds,
  imgDim: { width: number; height: number },
): { realX: number; realY: number } {
  const { originPx, farPx, xMin, xMax, yMin, yMax } = bounds;

  // Normalise to 0-1 within the bounded chart area
  const normX = (px.x - originPx.x) / (farPx.x - originPx.x);
  // Y is inverted: origin is at the bottom of the chart area
  const normY = 1 - (px.y - farPx.y) / (originPx.y - farPx.y);

  const realX = xMin + normX * (xMax - xMin);
  const realY = yMin + normY * (yMax - yMin);

  return { realX, realY };
}

/**
 * Interpolate a list of digitised points to produce one average stage height
 * per calendar day between startDate and endDate.
 *
 * Points are sorted by their realX (fractional day position) and linear
 * interpolation is used between adjacent points.
 *
 * @param points    - Sorted or unsorted array of DigiPoints
 * @param bounds    - Graph bounds (provides startDate, endDate, unit)
 */
export function interpolateDailyValues(
  points: DigiPoint[],
  bounds: GraphBounds,
): DailyRecord[] {
  if (points.length < 2) return [];

  const sorted = [...points].sort((a, b) => a.realX - b.realX);

  const start = new Date(bounds.startDate);
  const end = new Date(bounds.endDate);
  const totalDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;

  const records: DailyRecord[] = [];

  for (let d = 0; d < totalDays; d++) {
    const dateObj = new Date(start);
    dateObj.setDate(start.getDate() + d);
    const dateStr = dateObj.toISOString().slice(0, 10);

    // Map calendar day to realX space (0..xMax-xMin range)
    const dayFraction = (d / (totalDays - 1)) * (bounds.xMax - bounds.xMin) + bounds.xMin;

    const stageHeight = linearInterpolate(sorted, dayFraction);
    if (stageHeight !== null) {
      records.push({ date: dateStr, stageHeight: Math.round(stageHeight * 1000) / 1000, unit: bounds.unit });
    }
  }

  return records;
}

/** Linear interpolation between the bracketing DigiPoints for a given realX */
function linearInterpolate(sorted: DigiPoint[], targetX: number): number | null {
  if (targetX < sorted[0].realX || targetX > sorted[sorted.length - 1].realX) {
    // Clamp to first/last value rather than extrapolating
    if (targetX <= sorted[0].realX) return sorted[0].realY;
    return sorted[sorted.length - 1].realY;
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const p0 = sorted[i];
    const p1 = sorted[i + 1];
    if (targetX >= p0.realX && targetX <= p1.realX) {
      const t = (targetX - p0.realX) / (p1.realX - p0.realX);
      return p0.realY + t * (p1.realY - p0.realY);
    }
  }
  return null;
}
