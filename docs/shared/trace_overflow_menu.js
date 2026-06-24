/**
 * Trace Explorer "⋯" overflow menu wiring (Issue #383).
 *
 * On phone viewports the secondary trace actions (Observations, 🧠, Synapses)
 * collapse behind the "⋯" More-actions button and reveal as a popover when it
 * is tapped. The wiring used to live inline in app.js and ran twice — once
 * standalone and once via `initCompactTraceNav()` — so the toggle click was
 * bound twice. A single tap fired both listeners and each toggled the open
 * state, cancelling out, and the popover never appeared (Issue #383).
 *
 * Extracting the wiring here makes it (a) unit-testable with a parsed DOM and
 * (b) idempotent: a repeat call on the same wrapper is a no-op, so the popover
 * reliably opens on the first tap regardless of how many times the initialiser
 * runs.
 */

import { nextOverflowState } from "./trace_header.js";

/** Marks a wrapper as already wired so a second call is a safe no-op. */
const WIRED_ATTR = "data-overflow-menu-wired";

/**
 * Wire the overflow summary button so tapping it toggles the popover, and
 * close the popover on menu-item selection, outside click, or Escape.
 *
 * Idempotent — a second call on the same `wrapper` returns `false` without
 * binding duplicate handlers.
 *
 * @param {Element | null | undefined} wrapper The `.traceOverflow` element.
 * @param {Document} [documentRef] Document used for the outside-click and
 *   Escape listeners. Defaults to the wrapper's `ownerDocument`.
 * @returns {boolean} `true` when freshly wired; `false` when the wrapper or
 *   its summary button is missing, or it was already wired.
 */
export function wireTraceOverflowMenu(wrapper, documentRef) {
  if (!wrapper || typeof wrapper.querySelector !== "function") return false;
  const summary = wrapper.querySelector(".traceOverflowSummary");
  if (!summary) return false;
  // Guard against double-wiring (Issue #383).
  if (wrapper.getAttribute(WIRED_ATTR) === "true") return false;
  wrapper.setAttribute(WIRED_ATTR, "true");

  const doc = documentRef ?? wrapper.ownerDocument ?? null;

  const setOpen = (open) => {
    wrapper.setAttribute("data-overflow-open", open ? "true" : "false");
    summary.setAttribute("aria-expanded", open ? "true" : "false");
  };
  const close = () => setOpen(false);

  summary.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const isOpen = wrapper.getAttribute("data-overflow-open") === "true";
    setOpen(nextOverflowState(isOpen));
  });

  // Close when a menu item is chosen so the popup does not linger.
  wrapper.querySelectorAll(".traceOverflowMenu [role=menuitem]")
    .forEach((item) => item.addEventListener("click", () => close()));

  // Close on outside click and Escape.
  if (doc && typeof doc.addEventListener === "function") {
    doc.addEventListener("click", (ev) => {
      if (wrapper.getAttribute("data-overflow-open") !== "true") return;
      if (!wrapper.contains(/** @type {Node} */ (ev.target))) close();
    });
    doc.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") close();
    });
  }
  return true;
}
