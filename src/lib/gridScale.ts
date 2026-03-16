import { Platform } from 'react-native';

export interface DetectedGridScale {
  smallCellPxX: number;
  smallCellPxY: number;
  xSpanDays: number;
  ySpanFt: number;
  confidence?: number;
  lowConfidenceReason?: string;
  debugInfo?: string;
}

const HOURS_PER_FINE_X_CELL = 4;
const DAYS_PER_FINE_X_CELL = HOURS_PER_FINE_X_CELL / 24;
const FEET_PER_FINE_Y_CELL = 0.1;
const FINE_CELLS_PER_BOLD = 6;

interface LineBand {
  center: number;
  width: number;
  peak: number;
  weight: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) * 0.5 : sorted[mid];
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q)));
  return sorted[idx];
}

function normalize(values: number[]): number[] {
  let maxValue = 0;
  for (const value of values) {
    if (value > maxValue) maxValue = value;
  }
  if (maxValue <= 0) return values.map(() => 0);
  return values.map((value) => value / maxValue);
}

function movingAverage(values: number[], radius: number): number[] {
  if (values.length === 0 || radius <= 0) return [...values];
  const out = new Array<number>(values.length);
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - radius);
    const end = Math.min(values.length - 1, i + radius);
    let sum = 0;
    for (let j = start; j <= end; j++) {
      sum += values[j];
    }
    out[i] = sum / (end - start + 1);
  }
  return out;
}

function centeredSignal(values: number[]): number[] {
  const baseline = movingAverage(values, 10);
  return values.map((value, index) => value - baseline[index]);
}

function autocorrelation(signal: number[], lag: number): number {
  const roundedLag = Math.round(lag);
  const n = signal.length - roundedLag;
  if (roundedLag < 2 || n <= 12) return -Infinity;
  let sum = 0;
  let energyA = 0;
  let energyB = 0;
  for (let i = 0; i < n; i++) {
    const a = signal[i];
    const b = signal[i + roundedLag];
    sum += a * b;
    energyA += a * a;
    energyB += b * b;
  }
  const denom = Math.sqrt(energyA * energyB);
  return denom > 0 ? sum / denom : -Infinity;
}

function findAutocorrelationPeaks(signal: number[], minLag: number, maxLag: number): number[] {
  const peaks: number[] = [];
  const scores = new Array<number>(maxLag + 1).fill(-Infinity);

  for (let lag = minLag; lag <= maxLag; lag++) {
    scores[lag] = autocorrelation(signal, lag);
  }

  const validScores = scores.slice(minLag, maxLag + 1).filter((score) => Number.isFinite(score));
  const threshold = validScores.length > 0 ? quantile(validScores, 0.7) : -Infinity;

  for (let lag = minLag + 1; lag < maxLag; lag++) {
    const value = scores[lag];
    if (!Number.isFinite(value) || value < threshold) continue;
    if (value >= scores[lag - 1] && value >= scores[lag + 1]) {
      peaks.push(lag);
    }
  }

  return peaks;
}

function findLineBands(profile: number[], threshold: number): LineBand[] {
  const norm = normalize(profile);
  const bands: LineBand[] = [];
  let start = -1;

  for (let index = 0; index <= norm.length; index++) {
    const value = index < norm.length ? norm[index] : 0;
    const active = value >= threshold;

    if (active && start < 0) {
      start = index;
      continue;
    }

    if (active || start < 0) {
      continue;
    }

    const end = index - 1;
    let peak = 0;
    let weight = 0;
    let weightedSum = 0;
    for (let i = start; i <= end; i++) {
      const excess = Math.max(0, norm[i] - threshold);
      const contribution = excess + norm[i] * 0.35;
      if (norm[i] > peak) peak = norm[i];
      weight += contribution;
      weightedSum += i * contribution;
    }

    const width = end - start + 1;
    if (width >= 1 && weight > 0) {
      bands.push({
        center: weightedSum / weight,
        width,
        peak,
        weight: weight * Math.max(1, width * 0.6),
      });
    }

    start = -1;
  }

  return bands;
}

function spacingFromCenters(centers: number[], minGap: number, maxGap: number): number | null {
  if (centers.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < centers.length; i++) {
    const gap = centers[i] - centers[i - 1];
    if (gap >= minGap && gap <= maxGap) {
      gaps.push(gap);
    }
  }
  return gaps.length >= 2 ? median(gaps) : null;
}

function buildCandidateSpacings(centers: number[], minGap: number, maxGap: number): number[] {
  if (centers.length < 2) return [];

  const gaps: number[] = [];
  for (let i = 1; i < centers.length; i++) {
    gaps.push(centers[i] - centers[i - 1]);
  }

  const candidates: number[] = [];
  for (let start = 0; start < gaps.length; start++) {
    let running = 0;
    for (let width = 0; width < 3 && start + width < gaps.length; width++) {
      running += gaps[start + width];
      if (running >= minGap && running <= maxGap) {
        candidates.push(running);
      }
    }
  }

  const deduped: number[] = [];
  const sorted = candidates.sort((a, b) => a - b);
  for (const candidate of sorted) {
    if (deduped.every((value) => Math.abs(value - candidate) > 3)) {
      deduped.push(candidate);
    }
  }
  return deduped;
}

function selectStrongBands(bands: LineBand[]): LineBand[] {
  if (bands.length < 4) return bands;
  const weights = bands.map((band) => band.weight);
  const widths = bands.map((band) => band.width);
  const weightThreshold = quantile(weights, 0.6);
  const widthThreshold = quantile(widths, 0.6);
  const strong = bands.filter(
    (band) => band.weight >= weightThreshold || band.width >= widthThreshold,
  );
  return strong.length >= 4 ? strong : bands;
}

function latticeCoverageScore(
  bands: LineBand[],
  spacing: number,
): { score: number; matches: number; firstCenter: number; lastCenter: number } {
  if (bands.length < 3 || spacing <= 0) {
    return { score: -Infinity, matches: 0, firstCenter: 0, lastCenter: 0 };
  }

  const tolerance = Math.max(2.5, spacing * 0.09);
  const origins = bands.slice(0, Math.min(6, bands.length));
  let bestScore = -Infinity;
  let bestMatches = 0;
  let bestFirstCenter = 0;
  let bestLastCenter = 0;

  for (const originBand of origins) {
    let matchedWeight = 0;
    let matchedCount = 0;
    const matchedCenters: number[] = [];
    for (const band of bands) {
      const raw = Math.abs(band.center - originBand.center) % spacing;
      const distance = Math.min(raw, spacing - raw);
      if (distance <= tolerance) {
        matchedWeight += band.weight;
        matchedCount += 1;
        matchedCenters.push(band.center);
      }
    }

    const expectedLines = Math.max(
      2,
      Math.round((bands[bands.length - 1].center - bands[0].center) / spacing) + 1,
    );
    const density = Math.min(1.15, matchedCount / expectedLines);
    const score = matchedWeight * density * Math.log1p(spacing);
    if (score > bestScore) {
      bestScore = score;
      bestMatches = matchedCount;
      bestFirstCenter = matchedCenters[0] ?? 0;
      bestLastCenter = matchedCenters[matchedCenters.length - 1] ?? 0;
    }
  }

  return {
    score: bestScore,
    matches: bestMatches,
    firstCenter: bestFirstCenter,
    lastCenter: bestLastCenter,
  };
}

function fineGridSupportScore(signal: number[], boldSpacing: number): number {
  const smallSpacing = boldSpacing / 6;
  const halfBoldSpacing = boldSpacing / 2;
  const smallScore = autocorrelation(signal, smallSpacing);
  const boldScore = autocorrelation(signal, boldSpacing);
  const midScore = autocorrelation(signal, halfBoldSpacing);

  const safeSmall = Number.isFinite(smallScore) ? smallScore : -1;
  const safeBold = Number.isFinite(boldScore) ? boldScore : -1;
  const safeMid = Number.isFinite(midScore) ? midScore : -1;

  return safeSmall * 1.3 + safeBold * 0.6 + safeMid * 0.3;
}

function bandSupportForBoldSpacing(profile: number[], boldSpacing: number): number {
  const thresholds = [0.74, 0.66, 0.58, 0.5, 0.42];
  let best = -Infinity;

  for (const threshold of thresholds) {
    const bands = selectStrongBands(findLineBands(profile, threshold)).sort((a, b) => a.center - b.center);
    if (bands.length < 4) continue;
    const coverage = latticeCoverageScore(bands, boldSpacing);
    if (coverage.matches < 4) continue;
    const score = Math.log1p(Math.max(0, coverage.score)) + coverage.matches * 0.18;
    if (score > best) best = score;
  }

  return best;
}

function buildSmallSpacingCandidates(peaks: number[], minLag: number, maxLag: number): number[] {
  const candidates: number[] = [];
  for (const peak of peaks) {
    for (let delta = -4; delta <= 4; delta++) {
      const candidate = peak + delta;
      if (candidate >= minLag && candidate <= maxLag) {
        candidates.push(candidate);
      }
    }
  }

  const sorted = candidates.sort((a, b) => a - b);
  const deduped: number[] = [];
  for (const candidate of sorted) {
    if (deduped.every((value) => Math.abs(value - candidate) > 1)) {
      deduped.push(candidate);
    }
  }
  return deduped;
}

function estimateSmallSpacing(profile: number[], spanPx: number): { smallPx: number; score: number } | null {
  const signal = centeredSignal(normalize(profile));
  const minLag = Math.max(6, Math.floor(spanPx / 320));
  const maxLag = Math.min(Math.floor(spanPx / 5), 420);
  if (maxLag <= minLag + 2) return null;

  const peaks = findAutocorrelationPeaks(signal, minLag, maxLag);
  if (peaks.length === 0) return null;

  const candidates = buildSmallSpacingCandidates(peaks, minLag, maxLag);
  let best: { smallPx: number; score: number } | null = null;

  for (const lag of candidates) {
    const lag1 = autocorrelation(signal, lag);
    const lag2 = autocorrelation(signal, lag * 2);
    const lag3 = autocorrelation(signal, lag * 3);
    const lag6 = autocorrelation(signal, lag * 6);
    const lagHalf = lag / 2 >= minLag ? autocorrelation(signal, lag / 2) : -Infinity;

    const safe1 = Number.isFinite(lag1) ? lag1 : -1;
    const safe2 = Number.isFinite(lag2) ? lag2 : -1;
    const safe3 = Number.isFinite(lag3) ? lag3 : -1;
    const safe6 = Number.isFinite(lag6) ? lag6 : -1;
    const safeHalf = Number.isFinite(lagHalf) ? lagHalf : -1;

    const harmonicSupport = safe1 * 1.0 + safe2 * 0.8 + safe3 * 0.45 + safe6 * 1.8;
    const aliasPenalty = Math.max(0, safeHalf) * 1.2;
    const bandSupport = bandSupportForBoldSpacing(profile, lag * 6);
    const safeBandSupport = Number.isFinite(bandSupport) ? bandSupport : 0;
    const sizeBias = Math.min(0.28, lag / maxLag);
    const score = harmonicSupport - aliasPenalty + safeBandSupport * 0.45 + sizeBias;

    if (!best || score > best.score || (Math.abs(score - best.score) < 0.03 && lag > best.smallPx)) {
      best = { smallPx: lag, score };
    }
  }

  return best;
}

function estimateBoldSpacing(
  profile: number[],
  spanPx: number,
): { boldPx: number; matchedBands: number; threshold: number; firstCenter: number; lastCenter: number } | null {
  const thresholds = [0.82, 0.74, 0.66, 0.58, 0.5, 0.42, 0.34];
  const minBoldGap = Math.max(24, spanPx / 40);
  const maxBoldGap = spanPx / 2;
  const signal = centeredSignal(normalize(profile));

  let best: {
    boldPx: number;
    matchedBands: number;
    threshold: number;
    score: number;
    firstCenter: number;
    lastCenter: number;
  } | null = null;

  for (const threshold of thresholds) {
    const bands = findLineBands(profile, threshold);
    if (bands.length < 4) continue;

    const strongBands = selectStrongBands(bands).sort((a, b) => a.center - b.center);
    const strongCenters = strongBands.map((band) => band.center);
    const coarseSpacing = spacingFromCenters(strongCenters, minBoldGap / 2, maxBoldGap);
    const candidates = buildCandidateSpacings(strongCenters, minBoldGap, maxBoldGap);
    if (coarseSpacing && candidates.every((spacing) => Math.abs(spacing - coarseSpacing) > 3)) {
      candidates.push(coarseSpacing);
      candidates.sort((a, b) => a - b);
    }
    if (candidates.length === 0) continue;

    for (const candidate of candidates) {
      const coverage = latticeCoverageScore(strongBands, candidate);
      if (coverage.matches < 4) continue;

      const days = spanPx / candidate;
      if (!Number.isFinite(days) || days < 1 || days > 60) continue;

      const periodicity = fineGridSupportScore(signal, candidate);
      if (!Number.isFinite(periodicity) || periodicity <= -0.1) continue;

      const wholeBias = 1 - Math.min(0.45, Math.abs(days - Math.round(days)) / 0.5);
      const lineDensityBias = Math.min(1.15, Math.max(0.72, coverage.matches / Math.max(4, days)));
      const score = coverage.score * (0.72 + wholeBias * 0.18 + lineDensityBias * 0.1) + periodicity * 220;

      if (!best || score > best.score || (Math.abs(score - best.score) < 1e-6 && candidate < best.boldPx)) {
        best = {
          boldPx: candidate,
          matchedBands: coverage.matches,
          threshold,
          score,
          firstCenter: coverage.firstCenter,
          lastCenter: coverage.lastCenter,
        };
      }
    }
  }

  return best
    ? {
        boldPx: best.boldPx,
        matchedBands: best.matchedBands,
        threshold: best.threshold,
        firstCenter: best.firstCenter,
        lastCenter: best.lastCenter,
      }
    : null;
}

async function loadHtmlImage(uri: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (error) => reject(new Error(`Unable to load image for grid detection: ${String(error)}`));
    img.src = uri;
  });
}

function isReasonableSmallCell(candidate: number | null, axisSpanPx: number): candidate is number {
  if (!Number.isFinite(candidate)) return false;
  if (candidate == null) return false;
  return candidate >= 4 && candidate <= axisSpanPx / 2;
}

function selectAxisSmallCell(
  axisSpanPx: number,
  smallEstimate: { smallPx: number; score: number } | null,
  boldEstimate: { boldPx: number } | null,
): number | null {
  const direct = smallEstimate?.smallPx ?? null;
  const fromBold = boldEstimate ? boldEstimate.boldPx / FINE_CELLS_PER_BOLD : null;
  const directOk = isReasonableSmallCell(direct, axisSpanPx);
  const boldOk = isReasonableSmallCell(fromBold, axisSpanPx);

  if (directOk && boldOk) {
    const ratio = direct / fromBold;
    if (ratio >= 0.78 && ratio <= 1.28) {
      return (direct + fromBold) * 0.5;
    }

    const directCells = axisSpanPx / direct;
    const boldCells = axisSpanPx / fromBold;
    const directIntegerDistance = Math.abs(directCells - Math.round(directCells));
    const boldIntegerDistance = Math.abs(boldCells - Math.round(boldCells));
    return directIntegerDistance <= boldIntegerDistance ? direct : fromBold;
  }

  if (directOk) return direct;
  if (boldOk) return fromBold;
  return null;
}

type XDaySpanSelection = {
  rawDays: number;
  source: 'bold-spacing' | 'bold-intervals' | 'fine-cells';
};

function selectXDaySpan(
  width: number,
  xSmallDirectPx: number | null,
  xBoldEstimate: { boldPx: number; matchedBands: number } | null,
): XDaySpanSelection | null {
  const fromFineCells =
    xSmallDirectPx && Number.isFinite(xSmallDirectPx)
      ? (width / xSmallDirectPx) * DAYS_PER_FINE_X_CELL
      : null;
  const fromBoldSpacing =
    xBoldEstimate && Number.isFinite(xBoldEstimate.boldPx) && xBoldEstimate.boldPx > 0
      ? width / xBoldEstimate.boldPx
      : null;
  const fromBoldIntervals =
    xBoldEstimate && Number.isFinite(xBoldEstimate.matchedBands)
      ? Math.max(1, xBoldEstimate.matchedBands - 1)
      : null;

  let boldCandidate: XDaySpanSelection | null = null;
  if (fromBoldSpacing && Number.isFinite(fromBoldSpacing)) {
    if (
      fromBoldIntervals &&
      Number.isFinite(fromBoldIntervals) &&
      (xBoldEstimate?.matchedBands ?? 0) >= 5
    ) {
      // If spacing and interval-count agree reasonably, spacing preserves partial-day margins better.
      if (Math.abs(fromBoldSpacing - fromBoldIntervals) <= 2.5) {
        boldCandidate = { rawDays: fromBoldSpacing, source: 'bold-spacing' };
      } else {
        // If they disagree heavily, trust counted intervals.
        boldCandidate = { rawDays: fromBoldIntervals, source: 'bold-intervals' };
      }
    } else {
      boldCandidate = { rawDays: fromBoldSpacing, source: 'bold-spacing' };
    }
  }

  if (!boldCandidate && fromBoldIntervals && Number.isFinite(fromBoldIntervals)) {
    boldCandidate = { rawDays: fromBoldIntervals, source: 'bold-intervals' };
  }

  // If direct fine-grid and bold-based spans strongly disagree, prefer direct fine-grid span.
  if (
    fromFineCells &&
    Number.isFinite(fromFineCells) &&
    boldCandidate &&
    Number.isFinite(boldCandidate.rawDays)
  ) {
    const ratio = Math.max(fromFineCells, boldCandidate.rawDays) / Math.max(0.001, Math.min(fromFineCells, boldCandidate.rawDays));
    if (ratio > 1.35) {
      return { rawDays: fromFineCells, source: 'fine-cells' };
    }
    return boldCandidate;
  }

  if (boldCandidate) {
    return boldCandidate;
  }

  if (fromFineCells && Number.isFinite(fromFineCells)) {
    return { rawDays: fromFineCells, source: 'fine-cells' };
  }

  return null;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export async function detectGraphPaperScale(imageUri: string): Promise<DetectedGridScale | null> {
  if (Platform.OS !== 'web') return null;

  const img = await loadHtmlImage(imageUri);
  const maxW = 2400;
  const scale = Math.min(1, maxW / img.width);
  const width = Math.max(80, Math.round(img.width * scale));
  const height = Math.max(80, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(img, 0, 0, width, height);

  const { data } = ctx.getImageData(0, 0, width, height);
  const colDark = new Array<number>(width).fill(0);
  const rowDark = new Array<number>(height).fill(0);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const luminance = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];
      const dark = 255 - luminance;
      colDark[x] += dark;
      rowDark[y] += dark;
    }
  }

  // ── Determine authoritative small cell size from X autocorrelation ────────
  const xSmallEstimate = estimateSmallSpacing(colDark, width);
  const ySmallEstimate = estimateSmallSpacing(rowDark, height);
  const xBoldEstimate = estimateBoldSpacing(colDark, width);
  const yBoldEstimate = estimateBoldSpacing(rowDark, height);

  const xSmallCanvas = selectAxisSmallCell(width, xSmallEstimate, xBoldEstimate);
  const ySmallCanvas = selectAxisSmallCell(height, ySmallEstimate, yBoldEstimate);
  const xSmallForOutput = xSmallCanvas ?? ySmallCanvas;
  const ySmallForOutput = ySmallCanvas ?? xSmallCanvas;
  if (!xSmallForOutput || !ySmallForOutput) {
    return null;
  }

  // X day span should come from X-only evidence; do not blend with Y to avoid skew.
  const xDaySpan = selectXDaySpan(width, xSmallEstimate?.smallPx ?? null, xBoldEstimate);
  let rawDays = xDaySpan?.rawDays ?? NaN;
  if (!Number.isFinite(rawDays) || rawDays <= 0) {
    rawDays = (width / xSmallForOutput) * DAYS_PER_FINE_X_CELL;
  }

  const xCells = width / xSmallForOutput;
  const yCells = height / ySmallForOutput;
  const rawFt = yCells * FEET_PER_FINE_Y_CELL;

  const xSpanDays = Math.max(1 / 24, Math.round(rawDays * 24) / 24);
  const ySpanFt = Math.max(0.1, Math.round(rawFt * 100) / 100);

  if (!Number.isFinite(xSpanDays) || !Number.isFinite(ySpanFt) || xSpanDays <= 0 || ySpanFt <= 0) {
    return null;
  }

  const sourceSmallPxX = xSmallForOutput / scale;
  const sourceSmallPxY = ySmallForOutput / scale;
  const sourceBoldPxX = (xBoldEstimate?.boldPx ?? xSmallForOutput * FINE_CELLS_PER_BOLD) / scale;
  const sourceBoldPxY = (yBoldEstimate?.boldPx ?? ySmallForOutput * FINE_CELLS_PER_BOLD) / scale;
  const xSmallPxScaled = xSmallEstimate ? xSmallEstimate.smallPx / scale : null;
  const ySmallPxScaled = ySmallEstimate ? ySmallEstimate.smallPx / scale : null;

  const hasXSmall = Boolean(xSmallEstimate);
  const hasYSmall = Boolean(ySmallEstimate);
  const hasXBold = Boolean(xBoldEstimate);
  const hasYBold = Boolean(yBoldEstimate);
  const rawXyRatio =
    xSmallCanvas && ySmallCanvas && Number.isFinite(xSmallCanvas) && Number.isFinite(ySmallCanvas)
      ? ySmallCanvas / xSmallCanvas
      : 1;
  const ratioAgreement = rawXyRatio >= 0.92 && rawXyRatio <= 1.08
    ? 1
    : rawXyRatio >= 0.78 && rawXyRatio <= 1.28
      ? 0.7
      : 0.25;
  const xCellPlausibility = xCells >= 8 && xCells <= 220 ? 1 : 0.55;
  const yCellPlausibility = yCells >= 8 && yCells <= 220 ? 1 : 0.55;
  const bandSupport =
    ((xBoldEstimate?.matchedBands ?? 0) + (yBoldEstimate?.matchedBands ?? 0)) >= 10
      ? 1
      : ((xBoldEstimate?.matchedBands ?? 0) + (yBoldEstimate?.matchedBands ?? 0)) >= 6
        ? 0.75
        : 0.45;

  const confidence = clamp01(
    0.22 +
      (hasXSmall ? 0.2 : 0) +
      (hasYSmall ? 0.16 : 0) +
      (hasXBold ? 0.12 : 0) +
      (hasYBold ? 0.1 : 0) +
      ratioAgreement * 0.12 +
      xCellPlausibility * 0.04 +
      yCellPlausibility * 0.04 +
      bandSupport * 0.08,
  );
  const lowConfidenceReason =
    confidence < 0.62
      ? `Confidence ${(confidence * 100).toFixed(0)}%: weak/ambiguous grid signal.`
      : undefined;

  return {
    smallCellPxX: sourceSmallPxX,
    smallCellPxY: sourceSmallPxY,
    xSpanDays,
    ySpanFt,
    confidence,
    lowConfidenceReason,
    debugInfo:
      `smallX=${sourceSmallPxX.toFixed(1)} smallY=${sourceSmallPxY.toFixed(1)} ` +
      `boldX=${sourceBoldPxX.toFixed(1)} boldY=${sourceBoldPxY.toFixed(1)} ` +
      `xAutoSmall=${xSmallPxScaled?.toFixed(1) ?? 'na'} yAutoSmall=${ySmallPxScaled?.toFixed(1) ?? 'na'} ` +
      `xBands=${xBoldEstimate?.matchedBands ?? 'na'} yBands=${yBoldEstimate?.matchedBands ?? 'na'} ` +
      `xSpanSrc=${xDaySpan?.source ?? 'fallback'} ` +
      `cellsX=${xCells.toFixed(2)} cellsY=${yCells.toFixed(2)} ` +
      `conf=${(confidence * 100).toFixed(0)}% ` +
      `rawDays=${rawDays.toFixed(3)} -> ${xSpanDays}d rawFt=${rawFt.toFixed(3)} -> ${ySpanFt}ft`,
  };
}
