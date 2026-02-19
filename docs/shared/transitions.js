/**
 * Transition configuration for NEAT-AI Explore (#104).
 *
 * All animation durations are configurable via CSS custom properties so they
 * can be overridden at runtime. This module exposes the default values and a
 * helper to check whether the user prefers reduced motion.
 *
 * Performance guardrails:
 * - Only CSS `transform` and `opacity` are animated (GPU-composited).
 * - All transitions stay under 300 ms to avoid feeling sluggish.
 * - Animations are skipped entirely when `prefers-reduced-motion: reduce`.
 */

/** Default cross-fade duration for neuron panel transitions (ms). */
export const TRANSITION_FADE_MS = 180;

/** Default breadcrumb slide duration (ms). */
export const TRANSITION_BREADCRUMB_MS = 200;

/** Default per-item stagger delay for synapse list fade-in (ms). */
export const TRANSITION_SYNAPSE_STAGGER_MS = 25;

/** Maximum total stagger budget so large lists don't feel slow (ms). */
export const TRANSITION_SYNAPSE_MAX_STAGGER_MS = 250;

/** Default focus-badge pulse duration in the graph view (ms). */
export const TRANSITION_FOCUS_PULSE_MS = 280;

/**
 * Returns `true` when the user has enabled `prefers-reduced-motion: reduce`.
 *
 * When this is `true`, all animations should be skipped entirely (instant
 * swap, no fade, no slide). Call this before scheduling any transition.
 *
 * @returns {boolean}
 */
export function prefersReducedMotion() {
  if (typeof globalThis.matchMedia !== "function") return false;
  return globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Compute the stagger delay (ms) for a given item index in a list.
 *
 * The delay is capped so that even very long lists complete within
 * `TRANSITION_SYNAPSE_MAX_STAGGER_MS`.
 *
 * @param {number} index - Zero-based position in the list.
 * @param {number} totalItems - Total number of items being rendered.
 * @returns {number} Delay in milliseconds (0 when reduced motion is active).
 */
export function synapseStaggerDelay(index, totalItems) {
  if (totalItems <= 0) return 0;
  const perItem = totalItems > 1
    ? Math.min(
      TRANSITION_SYNAPSE_STAGGER_MS,
      TRANSITION_SYNAPSE_MAX_STAGGER_MS / (totalItems - 1),
    )
    : 0;
  return Math.round(index * perItem);
}
