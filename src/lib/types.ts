/** A stream gage monitoring site */
export interface Site {
  id: string;
  name: string;
  siteCode: string; // USGS or agency site code
  description?: string;
  latitude?: number;
  longitude?: number;
  createdAt: string; // ISO date string
}

/**
 * Pixel-space boundary corners the user defines on the chart image.
 * These define the mapping between pixel coords and real-world values.
 */
export interface GraphBounds {
  // Pixel positions of the axis origin and far corner (set by user tapping)
  originPx: { x: number; y: number }; // lower-left corner of the chart area
  farPx: { x: number; y: number }; // upper-right corner of the chart area

  // Real-world axis values
  xMin: number; // day-of-year or date ordinal at left edge
  xMax: number; // day-of-year or date ordinal at right edge
  yMin: number; // stage height at bottom (ft or m)
  yMax: number; // stage height at top (ft or m)

  // Date range (drives CSV date column)
  startDate: string; // ISO date, e.g. "2024-01-01"
  endDate: string; // ISO date, e.g. "2024-12-31"

  unit: 'ft' | 'm';
}

/** A single user-placed point on the digitized curve (pixel space) */
export interface DigiPoint {
  px: { x: number; y: number }; // pixel coordinates on the displayed image
  realX: number; // computed real-world X (fractional day)
  realY: number; // computed real-world Y (stage height)
}

/** One complete digitization session for a captured chart image */
export interface DigiSession {
  id: string;
  siteId: string;
  imageUri: string; // local file URI
  capturedAt: string; // ISO datetime
  status: 'captured' | 'bounded' | 'digitized' | 'exported';
  bounds?: GraphBounds;
  points?: DigiPoint[];
  exportedAt?: string;
}

/** One row in the CSV output */
export interface DailyRecord {
  date: string; // YYYY-MM-DD
  stageHeight: number; // interpolated value
  unit: 'ft' | 'm';
}
