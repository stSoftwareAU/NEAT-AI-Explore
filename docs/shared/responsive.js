/**
 * Responsive breakpoint constants and helpers for the trace explorer.
 *
 * Issue #108 — defines clear breakpoints:
 *   Mobile  (< 640px):  single-column vertical stack
 *   Tablet  (640–1024px): collapsible side panel
 *   Desktop (> 1024px):  side-by-side layout
 *
 * These constants are the single source of truth consumed by both
 * CSS (via matching media queries) and JS (for programmatic layout
 * decisions such as toggling the synapse panel).
 */

/** Upper bound (exclusive) for mobile layout. */
export const MOBILE_MAX = 640;

/** Upper bound (exclusive) for tablet layout. */
export const TABLET_MAX = 1024;

/** Minimum touch-target size in CSS px (Apple HIG). */
export const MIN_TOUCH_TARGET = 44;

/**
 * Classify a viewport width into a named breakpoint.
 *
 * @param {number} width — viewport width in CSS pixels
 * @returns {"mobile" | "tablet" | "desktop"}
 */
export function classifyBreakpoint(width) {
  if (typeof width !== "number" || !Number.isFinite(width)) {
    return "desktop"; // safe fallback
  }
  if (width < MOBILE_MAX) return "mobile";
  if (width < TABLET_MAX) return "tablet";
  return "desktop";
}

/**
 * Build a CSS media-query string for a given breakpoint.
 *
 * Useful when JS needs to register a `matchMedia` listener that
 * stays in sync with the CSS breakpoints.
 *
 * @param {"mobile" | "tablet" | "desktop"} bp
 * @returns {string} e.g. "(max-width: 639px)"
 */
export function mediaQueryFor(bp) {
  switch (bp) {
    case "mobile":
      return `(max-width: ${MOBILE_MAX - 1}px)`;
    case "tablet":
      return `(min-width: ${MOBILE_MAX}px) and (max-width: ${
        TABLET_MAX - 1
      }px)`;
    case "desktop":
      return `(min-width: ${TABLET_MAX}px)`;
    default:
      return `(min-width: ${TABLET_MAX}px)`;
  }
}
