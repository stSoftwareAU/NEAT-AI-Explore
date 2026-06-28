/**
 * Shared number formatting helpers (Issue #242).
 *
 * Every number the user sees in NEAT-AI Explore should pass through one of
 * these helpers so thousand-separators and decimal places stay consistent
 * across the app. All helpers handle `NaN`, `Infinity`, `null`, and
 * `undefined` by returning a stable placeholder
 * (`MISSING_NUMBER_PLACEHOLDER`).
 *
 * The Australian English locale (`en-AU`) is used so digit grouping uses
 * the comma separator throughout the UI.
 *
 * @module docs/shared/number_format
 */

/** Stable placeholder returned when a value is missing or non-finite. */
export const MISSING_NUMBER_PLACEHOLDER = "—";

/** Locale used for digit grouping across the app. */
const LOCALE = "en-AU";

/**
 * True when `value` is a finite JavaScript number. Strings and other types
 * deliberately do NOT coerce — callers should hand us numbers, not
 * stringly-typed values.
 *
 * @param {unknown} value
 * @returns {value is number}
 */
function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Format an integer with thousand-separators (e.g. `12,345`). Fractional
 * inputs are rounded by `Intl.NumberFormat`.
 *
 * @param {unknown} n
 * @returns {string}
 */
export function formatInteger(n) {
  if (!isFiniteNumber(n)) return MISSING_NUMBER_PLACEHOLDER;
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 }).format(n);
}

/**
 * Format a decimal with fixed decimal places (default 2) and
 * thousand-separators for the integer part.
 *
 * @param {unknown} n
 * @param {number} [places=2]
 * @returns {string}
 */
export function formatDecimal(n, places = 2) {
  if (!isFiniteNumber(n)) return MISSING_NUMBER_PLACEHOLDER;
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  }).format(n);
}
