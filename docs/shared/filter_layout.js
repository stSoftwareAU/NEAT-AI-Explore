/**
 * Inline-filters layout decision helpers (Issue #245).
 *
 * The inbound-synapses panel renders its filter controls (Min alloc imp,
 * Top K) inline on the same row as the heading whenever they fit, and
 * collapses them behind a "Filters" popover button when they would
 * overflow. Both decisions are made by these pure functions so the
 * logic is testable without a DOM.
 */

import { MOBILE_MAX } from "./responsive.js";

/**
 * Decide whether the inline filter controls fit on the same row as the
 * heading + sort select.
 *
 * @param {number} panelWidth   — measured width of the `.synapseList` panel,
 *                                or the `.synapseHeader` row, in CSS px.
 * @param {number} controlsWidth — natural width the inline controls need,
 *                                in CSS px.
 * @returns {"inline" | "collapsed"}
 */
export function decideFiltersMode(panelWidth, controlsWidth) {
  if (
    typeof panelWidth !== "number" || !Number.isFinite(panelWidth) ||
    typeof controlsWidth !== "number" || !Number.isFinite(controlsWidth)
  ) {
    return "inline"; // safe default — keep controls reachable
  }
  if (panelWidth <= 0 || controlsWidth <= 0) return "inline";
  return controlsWidth <= panelWidth ? "inline" : "collapsed";
}

/**
 * Fallback decision used when the controls width cannot be measured
 * (no `ResizeObserver`, no DOM access). Mirrors the existing
 * `MOBILE_MAX` heuristic — viewports narrower than 640px collapse.
 *
 * @param {number} panelWidth — measured panel width in CSS px.
 * @returns {"inline" | "collapsed"}
 */
export function decideFiltersModeByWidth(panelWidth) {
  if (typeof panelWidth !== "number" || !Number.isFinite(panelWidth)) {
    return "inline";
  }
  return panelWidth < MOBILE_MAX ? "collapsed" : "inline";
}
