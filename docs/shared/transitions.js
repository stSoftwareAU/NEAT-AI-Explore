/**
 * Shared transition configuration for NEAT-AI Explore (#104).
 *
 * All animation durations are in milliseconds and configurable via CSS custom
 * properties. This module is DOM-free so it can be unit-tested in Deno.
 *
 * Performance guardrails:
 * - Only `transform` and `opacity` are animated (GPU-composited).
 * - All durations stay under 300 ms to feel snappy.
 * - `prefers-reduced-motion: reduce` disables animations entirely.
 */

/* ── Duration constants (ms) ─────────────────────────────────────────────── */

/** Cross-fade duration when switching the current neuron panel. */
export const PANEL_CROSSFADE_MS = 180;

/** Breadcrumb slide / fade duration. */
export const BREADCRUMB_TRANSITION_MS = 200;

/** Staggered delay between consecutive synapse rows fading in. */
export const SYNAPSE_STAGGER_MS = 25;

/** Maximum total stagger so long lists don't take too long. */
export const SYNAPSE_STAGGER_CAP_MS = 250;

/** Duration for each synapse row's fade-in. */
export const SYNAPSE_FADE_MS = 180;

/** Camera fly-to duration in the graph explorer. */
export const CAMERA_FLY_MS = 250;

/** Focus-pulse highlight duration on a newly focused node. */
export const FOCUS_PULSE_MS = 280;

/* ── Helpers ─────────────────────────────────────────────────────────────── */

/**
 * Returns `true` when the user has requested reduced motion.
 *
 * Works in browsers (reads `prefers-reduced-motion` media query) and returns
 * `false` in non-browser environments (e.g. Deno test runner).
 *
 * @returns {boolean}
 */
export function prefersReducedMotion() {
  try {
    return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")
      ?.matches === true;
  } catch (_e) {
    return false;
  }
}

/**
 * Compute the per-item stagger delay for a list of N items, capped so the
 * total stagger never exceeds `SYNAPSE_STAGGER_CAP_MS`.
 *
 * @param {number} index       - Zero-based index of the item.
 * @param {number} totalItems  - Total number of items in the list.
 * @returns {number} Delay in ms for this item.
 */
export function synapseStaggerDelay(index, totalItems) {
  if (totalItems <= 0 || index < 0) return 0;
  const perItem = totalItems > 1
    ? Math.min(SYNAPSE_STAGGER_MS, SYNAPSE_STAGGER_CAP_MS / (totalItems - 1))
    : 0;
  return Math.round(perItem * index);
}
