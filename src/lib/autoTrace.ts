import { Platform } from 'react-native';

export type NormalizedPoint = { x: number; y: number };
type ScoredPoint = { x: number; y: number; confidence: number };

function movingAverage(values: number[], radius: number): number[] {
  if (values.length === 0 || radius <= 0) return values;
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - radius);
    const end = Math.min(values.length - 1, i + radius);
    let sum = 0;
    for (let j = start; j <= end; j++) sum += values[j];
    out.push(sum / (end - start + 1));
  }
  return out;
}

async function loadHtmlImage(uri: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error(`Unable to load image for auto-trace: ${String(e)}`));
    img.src = uri;
  });
}

type AiTile = {
  tileIndex: number;
  startNorm: number;
  endNorm: number;
  dataUrl: string;
};

export interface TraceOptions {
  /** 0..1 normalized x in source image to start tracing (default: 0) */
  xNormStart?: number;
  /** 0..1 normalized x to stop tracing (default: 1) */
  xNormEnd?: number;
  /** 0..1 center of vertical search band */
  yNormHint?: number;
  /** Half-height of search band as fraction of image (default 0.30) */
  yNormBand?: number;
  /** 0..1 starting y for continuity tracking (uses band midpoint if omitted) */
  yNormPrev?: number;
  /** Number of x samples across trace span (default: 260) */
  xSamples?: number;
  /** Increase dark threshold permissiveness (default: 18) */
  thresholdBoost?: number;
  /** Allow pixels this much lighter than threshold before hard reject (default: 28) */
  lightTolerance?: number;
  /** Continuity penalty multiplier; lower follows steep sections better (default: 0.62) */
  continuityWeight?: number;
  /** Vertical contrast contribution multiplier (default: 0.7) */
  contrastWeight?: number;
  /** Moving average radius for output y smoothing (default: 2) */
  smoothingRadius?: number;
  /** Penalize saturated colors (grid ink) to prefer graphite/gray line (default: 0.45) */
  saturationWeight?: number;
  /** Preferred luminance center for line scoring (auto if omitted) */
  targetLuminance?: number;
  /** Vertical search radius for continuity tracking in normalized units (default: 0.12) */
  searchRadiusNorm?: number;
  /** Preferred pencil/trace color in hex (e.g. #6d6d6d). */
  pencilColorHex?: string;
  /** Known gridline color in hex (e.g. #3e9bd1) to penalize grid matching. */
  gridColorHex?: string;
  /** Enable model-based AI tracing first (web only) */
  aiMode?: 'off' | 'openai';
  /** OpenAI API key used for AI tracing. If omitted, reads EXPO_PUBLIC_OPENAI_API_KEY. */
  openAIApiKey?: string;
  /** OpenAI model for vision tracing (default: gpt-4.1-mini). */
  openAIModel?: string;
  /** Timeout for AI request in milliseconds (default: 35000). */
  aiTimeoutMs?: number;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q)));
  return sorted[idx];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseHexColor(hex?: string): { r: number; g: number; b: number } | null {
  if (!hex) return null;
  const normalized = hex.trim().replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null;
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function estimateEdgeY(anchorPoints: ScoredPoint[], edgeX: number, yMin: number, yMax: number): number {
  const a = anchorPoints[0];
  if (!a) {
    return (yMin + yMax) * 0.5;
  }

  const b = anchorPoints[1];
  if (!b || Math.abs(b.x - a.x) < 1e-6) {
    return clamp(a.y, yMin, yMax);
  }

  const slope = (b.y - a.y) / (b.x - a.x);
  return clamp(a.y + slope * (edgeX - a.x), yMin, yMax);
}

function ensureTraceCoverage(
  points: ScoredPoint[],
  xStart: number,
  xEnd: number,
  yMin: number,
  yMax: number,
): ScoredPoint[] {
  if (points.length === 0) {
    return points;
  }

  const sorted = [...points].sort((a, b) => a.x - b.x);
  const out = [...sorted];
  const leftGap = out[0].x - xStart;
  if (leftGap > 1) {
    const leftY = estimateEdgeY(out.slice(0, 3), xStart, yMin, yMax);
    out.unshift({ x: xStart, y: leftY, confidence: out[0].confidence });
  } else {
    out[0] = { ...out[0], x: xStart };
  }

  const rightGap = xEnd - out[out.length - 1].x;
  if (rightGap > 1) {
    const tail = [...out].slice(-3).reverse();
    const rightY = estimateEdgeY(tail, xEnd, yMin, yMax);
    out.push({ x: xEnd, y: rightY, confidence: out[out.length - 1].confidence });
  } else {
    out[out.length - 1] = { ...out[out.length - 1], x: xEnd };
  }

  return out;
}

function canvasToDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/jpeg', 0.82);
}

function buildAiOverviewCanvas(img: HTMLImageElement): HTMLCanvasElement {
  const maxW = 1400;
  const scale = Math.min(1, maxW / img.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(80, Math.round(img.width * scale));
  canvas.height = Math.max(80, Math.round(img.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Unable to prepare AI overview canvas.');
  }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function buildAiTiles(overview: HTMLCanvasElement): AiTile[] {
  const tiles: AiTile[] = [];
  const tileCount = 3;
  const overlap = 0.14;
  const usableWidth = 1 + overlap * (tileCount - 1);
  const tileWidthNorm = usableWidth / tileCount;

  for (let i = 0; i < tileCount; i++) {
    const startNorm = Math.max(0, i * (tileWidthNorm - overlap));
    const endNorm = Math.min(1, startNorm + tileWidthNorm);
    const sx = Math.floor(startNorm * overview.width);
    const ex = Math.ceil(endNorm * overview.width);
    const sw = Math.max(24, ex - sx);

    const tileCanvas = document.createElement('canvas');
    tileCanvas.width = Math.min(900, sw);
    tileCanvas.height = Math.max(80, Math.round((overview.height / sw) * tileCanvas.width));
    const ctx = tileCanvas.getContext('2d');
    if (!ctx) {
      continue;
    }

    ctx.drawImage(overview, sx, 0, sw, overview.height, 0, 0, tileCanvas.width, tileCanvas.height);
    tiles.push({
      tileIndex: i,
      startNorm,
      endNorm,
      dataUrl: canvasToDataUrl(tileCanvas),
    });
  }

  return tiles;
}

function isAiTraceDegenerate(points: NormalizedPoint[]): boolean {
  if (points.length < 12) {
    return true;
  }

  const ys = points.map((p) => p.y);
  const yRange = Math.max(...ys) - Math.min(...ys);
  let totalVariation = 0;
  let meanAbsDeviation = 0;
  const first = points[0];
  const last = points[points.length - 1];
  const dx = Math.max(1e-6, last.x - first.x);

  for (let i = 1; i < points.length; i++) {
    totalVariation += Math.abs(points[i].y - points[i - 1].y);
  }

  for (const point of points) {
    const t = (point.x - first.x) / dx;
    const lineY = first.y + (last.y - first.y) * t;
    meanAbsDeviation += Math.abs(point.y - lineY);
  }
  meanAbsDeviation /= points.length;

  return yRange < 0.025 || totalVariation < 0.045 || meanAbsDeviation < 0.008;
}

function mergeAiTilePoints(
  tiles: AiTile[],
  parsedTiles: Array<{ tileIndex: number; points: Array<{ x: number; y: number }> }>,
): NormalizedPoint[] {
  const buckets = new Map<number, number[]>();

  for (const parsedTile of parsedTiles) {
    const tile = tiles.find((t) => t.tileIndex === parsedTile.tileIndex);
    if (!tile) {
      continue;
    }

    const ordered = [...parsedTile.points]
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
      .map((p) => ({ x: clamp01(p.x), y: clamp01(p.y) }))
      .sort((a, b) => a.x - b.x);

    for (const point of ordered) {
      const globalX = tile.startNorm + (tile.endNorm - tile.startNorm) * point.x;
      const key = Math.round(globalX * 360);
      const bucket = buckets.get(key) ?? [];
      bucket.push(point.y);
      buckets.set(key, bucket);
    }
  }

  const merged = Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([key, ys]) => ({
      x: key / 360,
      y: ys.reduce((sum, value) => sum + value, 0) / ys.length,
    }));

  if (merged.length < 8) {
    return [];
  }

  const densified: NormalizedPoint[] = [];
  for (let i = 0; i < merged.length - 1; i++) {
    const a = merged[i];
    const b = merged[i + 1];
    densified.push(a);
    const dx = b.x - a.x;
    const steps = Math.min(4, Math.max(0, Math.floor(dx * 260)));
    for (let s = 1; s <= steps; s++) {
      const t = s / (steps + 1);
      densified.push({
        x: a.x + dx * t,
        y: a.y + (b.y - a.y) * t,
      });
    }
  }
  densified.push(merged[merged.length - 1]);

  return densified;
}

function parseOpenAiText(responseJson: unknown): string {
  if (!responseJson || typeof responseJson !== 'object') return '';
  const asAny = responseJson as {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };

  if (typeof asAny.output_text === 'string' && asAny.output_text.trim().length > 0) {
    return asAny.output_text;
  }

  const chunks = asAny.output
    ?.flatMap((item) => item.content ?? [])
    .filter((c) => c?.type === 'output_text' && typeof c.text === 'string')
    .map((c) => c.text as string) ?? [];

  return chunks.join('\n').trim();
}

async function traceWithOpenAI(
  imageUri: string,
  options?: TraceOptions,
): Promise<NormalizedPoint[]> {
  if (typeof fetch === 'undefined') {
    return [];
  }

  const apiKey = options?.openAIApiKey ?? process.env.EXPO_PUBLIC_OPENAI_API_KEY;
  if (!apiKey) {
    return [];
  }

  const model = options?.openAIModel ?? process.env.EXPO_PUBLIC_OPENAI_TRACE_MODEL ?? 'gpt-4.1-mini';
  const timeoutMs = Math.max(5000, options?.aiTimeoutMs ?? 18000);
  const img = await loadHtmlImage(imageUri);
  const overviewCanvas = buildAiOverviewCanvas(img);
  const overviewDataUrl = canvasToDataUrl(overviewCanvas);
  const tiles = buildAiTiles(overviewCanvas);
  if (tiles.length === 0) {
    return [];
  }

  const bandText = options?.yNormHint != null
    ? `Focus on the line near y=${clamp01(options.yNormHint).toFixed(4)} with search half-band=${clamp01(options.yNormBand ?? 0.3).toFixed(4)}.`
    : 'Find the main continuous stage-height pen/pencil trace across the chart.';

  const prompt = [
    'Image 1 is the full chart for context. The following images are left-to-right zoomed tiles of the same chart.',
    'Identify the single hand-drawn hydrologic trace line only.',
    'Ignore graph paper grid lines, handwriting, numbers, arrows, axes, borders, and the bottom chart edge.',
    'Do not simplify the trace into a straight line. Preserve real wiggles, plateaus, sharp rises, and sharp drops.',
    'Return tile-local points for every tile image, ordered left-to-right, with x and y normalized to that tile image.',
    'If the line is faint in one section, infer it from adjacent visible segments in the same tile and the full overview, but keep the traced shape realistic.',
    bandText,
  ].join(' ');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: prompt },
              { type: 'input_image', image_url: overviewDataUrl },
              ...tiles.map((tile) => ({ type: 'input_image' as const, image_url: tile.dataUrl })),
            ],
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'trace_tiles',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                tiles: {
                  type: 'array',
                  minItems: tiles.length,
                  maxItems: tiles.length,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      tileIndex: { type: 'integer' },
                      points: {
                        type: 'array',
                        minItems: 12,
                        items: {
                          type: 'object',
                          additionalProperties: false,
                          properties: {
                            x: { type: 'number' },
                            y: { type: 'number' },
                          },
                          required: ['x', 'y'],
                        },
                      },
                    },
                    required: ['tileIndex', 'points'],
                  },
                },
              },
              required: ['tiles'],
            },
          },
        },
        max_output_tokens: 2200,
      }),
    });

    if (!response.ok) {
      return [];
    }

    const payload = await response.json();
    const text = parseOpenAiText(payload);
    if (!text) {
      return [];
    }

    const parsed = JSON.parse(text) as {
      tiles?: Array<{ tileIndex: number; points: Array<{ x: number; y: number }> }>;
    };
    const stitched = mergeAiTilePoints(tiles, parsed.tiles ?? []);
    if (stitched.length < 12 || isAiTraceDegenerate(stitched)) {
      return [];
    }

    return stitched;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Experimental auto-trace for web: follows the darkest continuous line across X.
 * Pass TraceOptions to restrict the region for a local retrace around a moved point.
 */
export async function traceGraphLineNormalized(
  imageUri: string,
  options?: TraceOptions,
): Promise<NormalizedPoint[]> {
  if (Platform.OS !== 'web' || typeof document === 'undefined' || typeof window === 'undefined') {
    return [];
  }

  if (options?.aiMode === 'openai') {
    const aiPoints = await traceWithOpenAI(imageUri, options);
    if (aiPoints.length >= 12) {
      return aiPoints;
    }
  }

  const img = await loadHtmlImage(imageUri);
  const maxW = 1200;
  const scale = Math.min(1, maxW / img.width);
  const w = Math.max(40, Math.round(img.width * scale));
  const h = Math.max(40, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];

  ctx.drawImage(img, 0, 0, w, h);
  const image = ctx.getImageData(0, 0, w, h);
  const data = image.data;

  // Estimate darkness threshold from luminance distribution.
  const luma: number[] = [];
  for (let i = 0; i < data.length; i += 4 * 12) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    luma.push(0.299 * r + 0.587 * g + 0.114 * b);
  }
  luma.sort((a, b) => a - b);
  const p25 = luma[Math.max(0, Math.floor(luma.length * 0.25) - 1)] ?? 110;
  const thresholdBoost = options?.thresholdBoost ?? 18;
  const darkThreshold = Math.min(165, p25 + thresholdBoost);
  const lightTolerance = Math.max(0, options?.lightTolerance ?? 28);
  const continuityWeight = Math.max(0, options?.continuityWeight ?? 0.62);
  const contrastWeight = Math.max(0, options?.contrastWeight ?? 0.7);
  const smoothingRadius = Math.max(0, Math.floor(options?.smoothingRadius ?? 2));
  const saturationWeight = Math.max(0, options?.saturationWeight ?? 0.45);
  const targetLuminance = options?.targetLuminance ?? Math.max(75, Math.min(170, p25 + 34));
  const pencilColor = parseHexColor(options?.pencilColorHex);
  const gridColor = parseHexColor(options?.gridColorHex);

  const xPixStart = options?.xNormStart != null ? Math.max(0, Math.floor(options.xNormStart * w)) : 0;
  const xPixEnd   = options?.xNormEnd   != null ? Math.min(w, Math.ceil(options.xNormEnd   * w)) : w;
  let yMin = Math.floor(h * 0.04);
  let yMax = Math.ceil(h * 0.96);
  if (options?.yNormHint != null) {
    const band = options.yNormBand ?? 0.30;
    yMin = Math.max(0, Math.floor((options.yNormHint - band) * h));
    yMax = Math.min(h - 1, Math.ceil((options.yNormHint + band) * h));
  }
  const xSamples = Math.max(60, Math.floor(options?.xSamples ?? 260));
  const xStep = Math.max(1, Math.round((xPixEnd - xPixStart) / xSamples));
  const points: { x: number; y: number; confidence: number }[] = [];
  const pixelCount = w * h;
  const luminance = new Float32Array(pixelCount);
  const saturation = new Float32Array(pixelCount);
  const redDominance = new Float32Array(pixelCount);
  const neutrality = new Float32Array(pixelCount);
  const integralStride = w + 1;
  const integralLum = new Float64Array((w + 1) * (h + 1));

  for (let y = 0; y < h; y++) {
    let rowLumSum = 0;
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const maxRgb = Math.max(r, g, b);
      const minRgb = Math.min(r, g, b);
      const sat = maxRgb <= 0 ? 0 : ((maxRgb - minRgb) / maxRgb) * 255;
      const red = Math.max(0, r - (g + b) * 0.5);
      const pos = y * w + x;

      luminance[pos] = lum;
      saturation[pos] = sat;
      redDominance[pos] = red;
      neutrality[pos] = Math.max(0, 255 - sat - red * 0.55);

      rowLumSum += lum;
      integralLum[(y + 1) * integralStride + (x + 1)] = integralLum[y * integralStride + (x + 1)] + rowLumSum;
    }
  }

  const luminanceAt = (x: number, y: number): number => {
    const xx = Math.max(0, Math.min(w - 1, x));
    const yy = Math.max(0, Math.min(h - 1, y));
    return luminance[yy * w + xx];
  };

  const boxMeanLuminance = (cx: number, cy: number, rx: number, ry: number): number => {
    const left = Math.max(0, cx - rx);
    const right = Math.min(w - 1, cx + rx);
    const top = Math.max(0, cy - ry);
    const bottom = Math.min(h - 1, cy + ry);
    const a = integralLum[top * integralStride + left];
    const b = integralLum[top * integralStride + (right + 1)];
    const c = integralLum[(bottom + 1) * integralStride + left];
    const d = integralLum[(bottom + 1) * integralStride + (right + 1)];
    const area = (right - left + 1) * (bottom - top + 1);
    return area > 0 ? (d - b - c + a) / area : 255;
  };

  const baseScoreAt = (x: number, y: number): number => {
    const xx = Math.max(0, Math.min(w - 1, x));
    const yy = Math.max(0, Math.min(h - 1, y));
    const pos = yy * w + xx;
    const idx = pos * 4;
    const red = data[idx];
    const green = data[idx + 1];
    const blue = data[idx + 2];
    const lum = luminance[pos];
    const localMean = boxMeanLuminance(xx, yy, 5, 5);
    const residualDark = Math.max(0, localMean - lum);
    const verticalContrast = Math.abs(luminanceAt(xx, yy + 1) - luminanceAt(xx, yy - 1));
    const horizontalContrast = Math.abs(luminanceAt(xx + 1, yy) - luminanceAt(xx - 1, yy));
    const contrast = verticalContrast * 0.85 + horizontalContrast * 0.35;
    const neutralBoost = Math.max(0, neutrality[pos] - 108) * 0.34;
    const redPenalty = redDominance[pos] * 2.35;
    const saturationPenalty = Math.max(0, saturation[pos] - 54) * saturationWeight * 0.85;
    const darkInkPenalty = lum < 58 ? (58 - lum) * 3.1 : 0;
    const overDarkResidualPenalty = residualDark > 48 ? (residualDark - 48) * 2.2 : 0;
    const topZonePenalty = yy < yMin + Math.max(10, Math.floor((yMax - yMin) * 0.14)) ? 18 : 0;
    const lightPenalty = Math.max(0, lum - (darkThreshold + lightTolerance)) * 1.2;
    const tonalReward = Math.max(0, 140 - Math.abs(lum - targetLuminance) * 1.1) * 0.2;
    const distanceToBandEdge = Math.min(yy - yMin, yMax - yy);
    const edgePenalty = distanceToBandEdge < 6 ? (6 - distanceToBandEdge) * 7 : 0;
    const colorDistance = (target: { r: number; g: number; b: number }): number => {
      const dr = red - target.r;
      const dg = green - target.g;
      const db = blue - target.b;
      return Math.sqrt(dr * dr + dg * dg + db * db);
    };
    const pencilBoost = pencilColor ? Math.max(0, 150 - colorDistance(pencilColor)) * 0.65 : 0;
    const gridPenalty = gridColor ? Math.max(0, 130 - colorDistance(gridColor)) * 0.95 : 0;

    return residualDark * 4.1 + contrast * contrastWeight + neutralBoost + tonalReward + pencilBoost - redPenalty - saturationPenalty - darkInkPenalty - overDarkResidualPenalty - topZonePenalty - lightPenalty - edgePenalty - gridPenalty;
  };

  if (xPixEnd - xPixStart < 2) {
    return [];
  }
  const xColumns: number[] = [xPixStart];
  const rightEdgeX = Math.max(xPixStart, xPixEnd - 1);
  for (let x = xPixStart + xStep; x < rightEdgeX; x += xStep) {
    xColumns.push(x);
  }
  if (xColumns[xColumns.length - 1] !== rightEdgeX) {
    xColumns.push(rightEdgeX);
  }

  const searchRadius = Math.max(8, Math.round(h * (options?.searchRadiusNorm ?? 0.12)));

  const yCount = yMax - yMin + 1;
  const scoreColumnAt = (x: number, y: number): number => {
    const center = baseScoreAt(x, y);
    const left = baseScoreAt(x - 1, y);
    const right = baseScoreAt(x + 1, y);
    return center * 0.6 + left * 0.2 + right * 0.2;
  };

  const traceDirection = (
    startColumnIndices: number[],
    startY: number,
    mode: 'coarse' | 'refine',
    guideTrack?: { y: number }[],
  ): { x: number; y: number; confidence: number }[] => {
    const pathLength = startColumnIndices.length;
    const backPointers = new Int16Array(pathLength * yCount);
    backPointers.fill(-1);

    let prevScores = new Float32Array(yCount);
    let currScores = new Float32Array(yCount);
    prevScores.fill(Number.NEGATIVE_INFINITY);

    for (let yi = 0; yi < yCount; yi++) {
      const y = yMin + yi;
      const startPenalty = Math.abs(y - startY) * 2.2;
      prevScores[yi] = scoreColumnAt(xColumns[startColumnIndices[0]], y) - startPenalty;
    }

    const transitionWeight = mode === 'coarse'
      ? 1.35 + continuityWeight * 3.2
      : 0.9 + continuityWeight * 2.0;
    const jumpFree = Math.max(8, Math.round((yMax - yMin) * 0.03));
    const scanRadius = mode === 'coarse'
      ? Math.max(6, Math.round(searchRadius * 0.58))
      : searchRadius;
    const guideBand = Math.max(10, Math.round((yMax - yMin) * 0.14));

    for (let step = 1; step < pathLength; step++) {
      currScores.fill(Number.NEGATIVE_INFINITY);
      const x = xColumns[startColumnIndices[step]];
      const guidedY = guideTrack?.[step]?.y;

      for (let yi = 0; yi < yCount; yi++) {
        const y = yMin + yi;
        if (guidedY != null && mode === 'refine' && Math.abs(y - guidedY) > guideBand) {
          continue;
        }
        const baseScore = scoreColumnAt(x, y);
        let bestPrev = -1;
        let bestScore = Number.NEGATIVE_INFINITY;
        const prevStart = Math.max(0, yi - scanRadius);
        const prevEnd = Math.min(yCount - 1, yi + scanRadius);

        for (let prevYi = prevStart; prevYi <= prevEnd; prevYi++) {
          const dy = Math.abs(yi - prevYi);
          const extraJump = Math.max(0, dy - jumpFree);
          const penalty = dy * transitionWeight + extraJump * extraJump * 0.22;
          const candidate = prevScores[prevYi] - penalty;
          if (candidate > bestScore) {
            bestScore = candidate;
            bestPrev = prevYi;
          }
        }

        currScores[yi] = baseScore + bestScore;
        backPointers[step * yCount + yi] = bestPrev;
      }

      const temp = prevScores;
      prevScores = currScores;
      currScores = temp;
    }

    let bestEndYi = 0;
    let bestEndScore = Number.NEGATIVE_INFINITY;
    for (let yi = 0; yi < yCount; yi++) {
      if (prevScores[yi] > bestEndScore) {
        bestEndScore = prevScores[yi];
        bestEndYi = yi;
      }
    }

    const out: { x: number; y: number; confidence: number }[] = new Array(pathLength);
    let currentYi = bestEndYi;
    for (let step = pathLength - 1; step >= 0; step--) {
      const x = xColumns[startColumnIndices[step]];
      const y = yMin + currentYi;
      out[step] = { x, y, confidence: scoreColumnAt(x, y) };
      if (step > 0) {
        currentYi = backPointers[step * yCount + currentYi];
        if (currentYi < 0) {
          currentYi = bestEndYi;
        }
      }
    }

    return out;
  };

  const seedIdx = options?.yNormPrev != null ? 0 : Math.floor(xColumns.length / 2);
  const seedX = xColumns[seedIdx];
  let seedY = options?.yNormPrev != null
    ? Math.max(yMin, Math.min(yMax, Math.round(options.yNormPrev * h)))
    : Math.floor((yMin + yMax) / 2);

  if (options?.yNormPrev == null) {
    let bestSeedScore = Number.NEGATIVE_INFINITY;
    for (let y = yMin; y <= yMax; y++) {
      const seedScore = scoreColumnAt(seedX, y)
        + (seedIdx > 0 ? scoreColumnAt(xColumns[seedIdx - 1], y) * 0.55 : 0)
        + (seedIdx < xColumns.length - 1 ? scoreColumnAt(xColumns[seedIdx + 1], y) * 0.55 : 0);
      if (seedScore > bestSeedScore) {
        bestSeedScore = seedScore;
        seedY = y;
      }
    }
  }

  const rightColumns = Array.from({ length: xColumns.length - seedIdx }, (_, i) => seedIdx + i);
  const leftColumns = seedIdx > 0 ? Array.from({ length: seedIdx + 1 }, (_, i) => seedIdx - i) : [];

  const rightCoarse = traceDirection(rightColumns, seedY, 'coarse');
  const rightTrack = traceDirection(rightColumns, seedY, 'refine', rightCoarse);
  if (leftColumns.length > 0) {
    const leftCoarse = traceDirection(leftColumns, seedY, 'coarse');
    const leftTrack = traceDirection(leftColumns, seedY, 'refine', leftCoarse).reverse();
    points.push(...leftTrack.slice(0, -1), ...rightTrack);
  } else {
    points.push(...rightTrack);
  }

  // Trim noisy leading/trailing sections so trace starts/ends on stable line content.
  if (points.length >= 20) {
    const confidences = points
      .map((p) => p.confidence)
      .filter((v) => Number.isFinite(v));
    const confFloor = quantile(confidences, 0.30);
    const jumpLimit = Math.max(10, Math.round((yMax - yMin) * 0.12));
    const window = Math.min(8, Math.max(4, Math.floor(points.length * 0.02)));

    const isStableAt = (i: number): boolean => {
      const p = points[i];
      if (!p || p.confidence < confFloor) return false;
      if (i > 0 && Math.abs(p.y - points[i - 1].y) > jumpLimit) return false;
      if (i < points.length - 1 && Math.abs(points[i + 1].y - p.y) > jumpLimit) return false;
      return true;
    };

    let startIdx = 0;
    for (let i = 0; i <= points.length - window; i++) {
      let ok = true;
      for (let k = 0; k < window; k++) {
        if (!isStableAt(i + k)) {
          ok = false;
          break;
        }
      }
      if (ok) {
        startIdx = i;
        break;
      }
    }

    let endIdx = points.length - 1;
    for (let i = points.length - window - 1; i >= 0; i--) {
      let ok = true;
      for (let k = 0; k < window; k++) {
        if (!isStableAt(i + k)) {
          ok = false;
          break;
        }
      }
      if (ok) {
        endIdx = i + window - 1;
        break;
      }
    }

    const keepPad = Math.max(2, Math.floor(window * 0.8));
    startIdx = Math.max(0, startIdx - keepPad);
    endIdx = Math.min(points.length - 1, endIdx + Math.floor(keepPad * 0.5));

    if (endIdx - startIdx + 1 >= Math.max(12, window * 2)) {
      points.splice(endIdx + 1);
      points.splice(0, startIdx);
    }
  }

  const coveredPoints = ensureTraceCoverage(points, xPixStart, rightEdgeX, yMin, yMax);
  const minPoints = options?.xNormStart != null ? 2 : 8;
  if (coveredPoints.length < minPoints) {
    return [];
  }

  // Remove obvious jump spikes, then smooth Y while keeping X monotonic.
  const jumpThreshold = Math.max(10, h * 0.22);
  const deSpiked = coveredPoints.map((p, i, arr) => {
    if (i === 0 || i === arr.length - 1) return p.y;
    const a = arr[i - 1].y;
    const b = arr[i].y;
    const c = arr[i + 1].y;
    const median = [a, b, c].sort((m, n) => m - n)[1];
    return Math.abs(b - median) > jumpThreshold ? median : b;
  });

  const smoothedY = movingAverage(deSpiked, smoothingRadius);
  const normalized: NormalizedPoint[] = coveredPoints.map((p, i) => ({
    x: p.x / (w - 1),
    y: smoothedY[i] / (h - 1),
  }));

  return normalized.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}
