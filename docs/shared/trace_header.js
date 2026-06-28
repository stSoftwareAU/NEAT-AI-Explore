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
 * Toggle the open/closed state of the overflow menu. Pure helper — the
 * caller passes the current state and gets the next state back.
 *
 * @param {boolean} isOpen
 * @returns {boolean}
 */
export function nextOverflowState(isOpen) {
  return !isOpen;
}

/**
 * Issue #246 — decide whether the Trace Explorer overflow controls should
 * collapse behind the "⋯" popover or render inline. The previous behaviour
 * collapsed on every viewport narrower than `MOBILE_MAX` (a hard-coded
 * media query) which hid the buttons even when the trace bar had plenty of
 * room left.
 *
 * Pure helper so the threshold can be unit-tested without a DOM:
 *  - When the trace bar's flex children fit inside the bar's content width
 *    (`childrenWidth <= barWidth - padding`), keep them inline.
 *  - When they overflow, collapse behind the popover.
 *  - Edge case: `childrenWidth === barWidth` (with zero padding) ⇒ inline
 *    because the row exactly fits.
 *
 * Invalid or missing measurements fall back to `false` (inline) so the
 * controls stay reachable while the first layout pass settles.
 *
 * @param {{ barWidth?: number, childrenWidth?: number, padding?: number }} m
 * @returns {boolean} `true` when the controls should collapse.
 */
export function shouldCollapseTraceOverflow(m) {
  if (!m || typeof m !== "object") return false;
  const barWidth = /** @type {number} */ (m.barWidth);
  const childrenWidth = /** @type {number} */ (m.childrenWidth);
  const padding = typeof m.padding === "number" && Number.isFinite(m.padding)
    ? Math.max(0, m.padding)
    : 0;
  if (
    typeof barWidth !== "number" || !Number.isFinite(barWidth) ||
    typeof childrenWidth !== "number" || !Number.isFinite(childrenWidth)
  ) {
    return false;
  }
  if (barWidth <= 0 || childrenWidth <= 0) return false;
  const available = Math.max(0, barWidth - padding);
  return childrenWidth > available;
}

/**
 * Issue #384 — gate the "⋯" overflow button on there being at least one
 * visible action to reveal. The collapse decision in
 * `shouldCollapseTraceOverflow()` is driven purely by a width measurement,
 * so the button can show even when the overflow menu has nothing to offer.
 *
 * Pure, DOM-free helper: the caller counts the visible `role="menuitem"`
 * children (skipping `display:none`) and passes the tally in. Returns
 * `true` only when there is ≥1 visible action — when it returns `false`
 * the caller forces inline mode so the summary stays hidden and `⋯` does
 * not render (rather than leaving an inert button behind).
 *
 * Invalid or missing counts fall back to `false` (no actions) so a bad
 * measurement never leaves an empty overflow button on screen.
 *
 * @param {{ visibleActionCount?: number }} m
 * @returns {boolean} `true` when the overflow menu has at least one action.
 */
export function hasOverflowActions(m) {
  if (!m || typeof m !== "object") return false;
  const count = /** @type {number} */ (m.visibleActionCount);
  if (typeof count !== "number" || !Number.isFinite(count)) return false;
  return count >= 1;
}
