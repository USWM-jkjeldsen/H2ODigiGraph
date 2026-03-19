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
    const y = dateObj.getFullYear();
    const mo = String(dateObj.getMonth() + 1).padStart(2, '0');
    const dy = String(dateObj.getDate()).padStart(2, '0');
    const dateStr = `${y}-${mo}-${dy}`;

    const dayFraction = (d / Math.max(1, totalDays - 1)) * (bounds.xMax - bounds.xMin) + bounds.xMin;
    const stageHeight = linearInterpolate(sorted, dayFraction);
    if (stageHeight !== null) {
      records.push({ date: dateStr, stageHeight: Math.round(stageHeight * 1000) / 1000, unit: bounds.unit });
    }
  }

  return records;
}

/**
 * Interpolate digitised points into fixed 4-hour records.
 */
export function interpolate4HourValues(
  points: DigiPoint[],
  bounds: GraphBounds,
): DailyRecord[] {
  if (points.length < 2) return [];

  const sorted = [...points].sort((a, b) => a.realX - b.realX);

  const startMs = new Date(bounds.startDate).getTime();
  const endMs = new Date(bounds.endDate).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];

  const totalDurationMs = endMs - startMs;
  const intervalMs = 4 * 60 * 60 * 1000;

  const records: DailyRecord[] = [];

  for (let ts = startMs; ts <= endMs; ts += intervalMs) {
    const dateObj = new Date(ts);

    const y = dateObj.getFullYear();
    const mo = String(dateObj.getMonth() + 1).padStart(2, '0');
    const dy = String(dateObj.getDate()).padStart(2, '0');
    const hh = String(dateObj.getHours()).padStart(2, '0');
    const mm = String(dateObj.getMinutes()).padStart(2, '0');
    const dateStr = `${y}-${mo}-${dy} ${hh}:${mm}`;

    const position = (ts - startMs) / totalDurationMs;
    const targetX = position * (bounds.xMax - bounds.xMin) + bounds.xMin;

    const stageHeight = linearInterpolate(sorted, targetX);
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
