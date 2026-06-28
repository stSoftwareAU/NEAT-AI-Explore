/**
 * Responsive breakpoint constant for the trace explorer.
 *
 * Issue #108 — single source of truth for the mobile breakpoint, shared by
 * the trace header (`trace_header.js`) and filter-panel layout
 * (`filter_layout.js`) helpers so their collapse thresholds stay in sync
 * with the CSS media queries.
 *
 *   Mobile (< 640px): single-column vertical stack
 *
 * Note (Issue #395): the previous `classifyBreakpoint`, `mediaQueryFor`,
 * `TABLET_MAX` and `MIN_TOUCH_TARGET` exports were never wired into the
 * application and have been removed as dead code. Only `MOBILE_MAX` remains
 * because it is imported by the layout helpers above.
 */

/** Upper bound (exclusive) for mobile layout, in CSS pixels. */
export const MOBILE_MAX = 640;
