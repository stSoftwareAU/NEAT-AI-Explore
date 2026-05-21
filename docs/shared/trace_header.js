/**
 * Trace Explorer header/nav helpers — pure, DOM-free.
 *
 * Issue #184 — on phone viewports the Trace Explorer wastes vertical room:
 * the app header (theme `A` toggle) and the trace nav row (Path + breadcrumb
 * + buttons) sit on separate lines, and the inbound-allocation score is
 * tucked away inside a modal. This module exposes the pure logic used by
 * the compact mobile layout so it can be unit-tested without a DOM.
 *
 * Last updated: 21-May-2026
 */

import { MOBILE_MAX } from "./responsive.js";

/**
 * Format the inbound-allocation Σ score for display beside "Path:" on the
 * Trace Explorer breadcrumb line. Returns `null` when the score should
 * not be shown (no allocation yet, missing field, or a non-finite value).
 *
 * Trailing zeros are trimmed so the inline label stays compact
 * ("0.5" rather than "0.5000"). Exponential forms (e.g. "1.235e-7")
 * are left intact.
 *
 * @param {{ totalScore?: unknown } | null | undefined} allocation
 * @param {number} [precision=4] Significant digits to show.
 * @returns {string | null}
 */
export function formatTraceScore(allocation, precision = 4) {
  if (!allocation || typeof allocation !== "object") return null;
  const v = /** @type {{ totalScore?: unknown }} */ (allocation).totalScore;
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const p = Number.isFinite(precision) && precision > 0
    ? Math.min(21, Math.max(1, Math.floor(precision)))
    : 4;
  let s = v.toPrecision(p);
  if (!/e/i.test(s) && s.includes(".")) {
    s = s.replace(/0+$/, "").replace(/\.$/, "");
  }
  return s;
}

/**
 * Decide whether the compact phone header layout should be used.
 * Mirrors the CSS `@media (max-width: 639px)` query so JS placement
 * (e.g. moving the theme toggle into the trace nav row) stays in sync
 * with CSS rules.
 *
 * @param {number} width Viewport width in CSS pixels.
 * @returns {boolean}
 */
export function shouldUseCompactHeader(width) {
  if (typeof width !== "number" || !Number.isFinite(width)) return false;
  return width < MOBILE_MAX;
}

/**
 * Toggle the open/closed state of the overflow menu. Pure helper — the
 * caller passes the current state and gets the next state back.
 *
 * @param {boolean} isOpen
 * @returns {boolean}
 */
export function nextOverflowState(isOpen) {
  return !isOpen;
}
