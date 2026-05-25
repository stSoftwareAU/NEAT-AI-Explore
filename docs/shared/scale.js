/**
 * Pure scaling helpers for visualisation.
 *
 * DOM-free; safe to import from tests and browser code alike.
 *
 * @module
 */

/**
 * Map a non-negative `value` onto a pixel range `[minPx, maxPx]` using a
 * natural-log compression, so that small values stay visible while large
 * values do not blow out.
 *
 * Formula: `ln(value + 1) / ln(maxValue + 1)` mapped linearly to
 * `[minPx, maxPx]`. Returns `minPx` when `value <= 0`, `maxValue <= 0`,
 * or any input is non-finite. The result is always clamped to
 * `[minPx, maxPx]`.
 *
 * @param {number} value
 * @param {number} maxValue
 * @param {number} minPx
 * @param {number} maxPx
 * @returns {number}
 */
export function logScalePixels(value, maxValue, minPx, maxPx) {
  if (
    !Number.isFinite(value) ||
    !Number.isFinite(maxValue) ||
    !Number.isFinite(minPx) ||
    !Number.isFinite(maxPx)
  ) {
    return Number.isFinite(minPx) ? minPx : 0;
  }
  if (value <= 0 || maxValue <= 0) return minPx;

  const lo = Math.min(minPx, maxPx);
  const hi = Math.max(minPx, maxPx);

  const t = Math.log(value + 1) / Math.log(maxValue + 1);
  const px = minPx + (maxPx - minPx) * t;
  if (px < lo) return lo;
  if (px > hi) return hi;
  return px;
}
