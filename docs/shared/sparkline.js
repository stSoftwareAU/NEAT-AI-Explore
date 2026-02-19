/**
 * Sparkline computation utilities for neuron detail cards (#107).
 *
 * Pure, DOM-free functions that convert raw data arrays into drawable
 * point coordinates. The rendering (canvas/SVG) lives in the browser
 * code; this module handles only the maths so it can be unit-tested
 * in Deno.
 *
 * Australian English note:
 * - Keep spellings like "colour", "behaviour", "normalise".
 *
 * Last updated: 20-Feb-2026
 */

/* ── Sparkline point computation ────────────────────────────────────────── */

/**
 * Normalise a data series into [0, 1] coordinates suitable for sparkline
 * rendering.
 *
 * Each point maps an observation index to an x in [0, 1] and its value
 * to a y in [0, 1] (0 = bottom, 1 = top). When all values are identical
 * the y is pinned to 0.5.
 *
 * @param {number[]} values - Raw data values (one per observation).
 * @returns {{ points: Array<{x: number, y: number}>, min: number, max: number }}
 */
export function computeSparklinePoints(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return { points: [], min: 0, max: 0 };
  }

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }

  // All values non-finite → empty
  if (!Number.isFinite(min)) {
    return { points: [], min: 0, max: 0 };
  }

  const range = max - min;
  const n = values.length;
  const points = [];
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    const x = n === 1 ? 0.5 : i / (n - 1);
    const y = range === 0 ? 0.5 : (v - min) / range;
    points.push({ x, y });
  }

  return { points, min, max };
}

/* ── Error histogram computation ────────────────────────────────────────── */

/**
 * Bucket error values into a histogram suitable for a mini bar chart.
 *
 * @param {number[]} errors - Flat array of error values.
 * @param {number} [bucketCount=10] - Number of histogram buckets.
 * @returns {{ buckets: Array<{low: number, high: number, count: number, ratio: number}>, min: number, max: number }}
 */
export function computeErrorHistogram(errors, bucketCount = 10) {
  if (
    !Array.isArray(errors) || errors.length === 0 || bucketCount < 1
  ) {
    return { buckets: [], min: 0, max: 0 };
  }

  const finite = errors.filter(Number.isFinite);
  if (finite.length === 0) {
    return { buckets: [], min: 0, max: 0 };
  }

  let min = Infinity;
  let max = -Infinity;
  for (const v of finite) {
    if (v < min) min = v;
    if (v > max) max = v;
  }

  const range = max - min;
  const bCount = Math.max(1, Math.round(bucketCount));
  const buckets = [];
  for (let i = 0; i < bCount; i++) {
    const low = min + (range * i) / bCount;
    const high = min + (range * (i + 1)) / bCount;
    buckets.push({ low, high, count: 0, ratio: 0 });
  }

  for (const v of finite) {
    let idx = range === 0 ? 0 : Math.floor(((v - min) / range) * bCount);
    if (idx >= bCount) idx = bCount - 1;
    buckets[idx].count++;
  }

  const maxCount = Math.max(...buckets.map((b) => b.count));
  if (maxCount > 0) {
    for (const b of buckets) {
      b.ratio = b.count / maxCount;
    }
  }

  return { buckets, min, max };
}

/* ── Squash badge classification ────────────────────────────────────────── */

/**
 * Map an activation function name to a colour badge category.
 *
 * @param {string} squash - Activation function name (e.g. "SIGMOID", "RELU").
 * @returns {{ label: string, colour: string }}
 */
export function squashBadge(squash) {
  const s = String(squash ?? "").toUpperCase();
  switch (s) {
    case "SIGMOID":
    case "LOGISTIC":
      return { label: s, colour: "blue" };
    case "TANH":
      return { label: s, colour: "purple" };
    case "RELU":
    case "LEAKY_RELU":
      return { label: s, colour: "green" };
    case "STEP":
    case "BIPOLAR":
    case "BIPOLAR_SIGMOID":
      return { label: s, colour: "orange" };
    case "IDENTITY":
      return { label: s, colour: "grey" };
    default:
      return { label: s || "UNKNOWN", colour: "grey" };
  }
}

/* ── Flat error extraction ──────────────────────────────────────────────── */

/**
 * Flatten a 2D errors array (observations × error-dimensions) into a single
 * array of absolute error values suitable for histogram display.
 *
 * @param {number[][] | number[] | null} errors - Per-observation error arrays.
 * @returns {number[]}
 */
export function flattenErrors(errors) {
  if (!Array.isArray(errors) || errors.length === 0) return [];

  // If first element is an array → 2D
  if (Array.isArray(errors[0])) {
    const flat = [];
    for (const row of errors) {
      if (!Array.isArray(row)) continue;
      for (const v of row) {
        if (Number.isFinite(v)) flat.push(Math.abs(v));
      }
    }
    return flat;
  }

  // 1D array
  return errors.filter(Number.isFinite).map((v) => Math.abs(v));
}
