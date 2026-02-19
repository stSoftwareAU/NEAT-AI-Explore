/**
 * Tests for the transitions configuration module (#104).
 *
 * Verifies exported constants, the reduced-motion helper, and the
 * synapse stagger delay calculation.
 */

import { assert, assertEquals } from "./test_helpers.ts";
import {
  prefersReducedMotion,
  synapseStaggerDelay,
  TRANSITION_BREADCRUMB_MS,
  TRANSITION_FADE_MS,
  TRANSITION_FOCUS_PULSE_MS,
  TRANSITION_SYNAPSE_MAX_STAGGER_MS,
  TRANSITION_SYNAPSE_STAGGER_MS,
} from "../docs/shared/transitions.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

Deno.test("TRANSITION_FADE_MS is under 300 ms", () => {
  assert(TRANSITION_FADE_MS < 300, "expected TRANSITION_FADE_MS < 300");
});

Deno.test("TRANSITION_BREADCRUMB_MS is under 300 ms", () => {
  assert(
    TRANSITION_BREADCRUMB_MS < 300,
    "expected TRANSITION_BREADCRUMB_MS < 300",
  );
});

Deno.test("TRANSITION_FOCUS_PULSE_MS is under 300 ms", () => {
  assert(
    TRANSITION_FOCUS_PULSE_MS < 300,
    "expected TRANSITION_FOCUS_PULSE_MS < 300",
  );
});

Deno.test("TRANSITION_SYNAPSE_STAGGER_MS is positive", () => {
  assert(
    TRANSITION_SYNAPSE_STAGGER_MS > 0,
    "expected TRANSITION_SYNAPSE_STAGGER_MS > 0",
  );
});

Deno.test("TRANSITION_SYNAPSE_MAX_STAGGER_MS is under 300 ms", () => {
  assert(
    TRANSITION_SYNAPSE_MAX_STAGGER_MS < 300,
    "expected TRANSITION_SYNAPSE_MAX_STAGGER_MS < 300",
  );
});

// ---------------------------------------------------------------------------
// prefersReducedMotion
// ---------------------------------------------------------------------------

Deno.test("prefersReducedMotion returns false in Deno (no matchMedia)", () => {
  // Deno does not provide window.matchMedia, so the function should
  // gracefully return false rather than throwing.
  assertEquals(prefersReducedMotion(), false);
});

// ---------------------------------------------------------------------------
// synapseStaggerDelay
// ---------------------------------------------------------------------------

Deno.test("synapseStaggerDelay returns 0 for first item", () => {
  assertEquals(synapseStaggerDelay(0, 10), 0);
});

Deno.test("synapseStaggerDelay returns 0 for single item", () => {
  assertEquals(synapseStaggerDelay(0, 1), 0);
});

Deno.test("synapseStaggerDelay returns 0 for zero items", () => {
  assertEquals(synapseStaggerDelay(0, 0), 0);
});

Deno.test("synapseStaggerDelay increases with index for small lists", () => {
  const d0 = synapseStaggerDelay(0, 5);
  const d1 = synapseStaggerDelay(1, 5);
  const d4 = synapseStaggerDelay(4, 5);
  assertEquals(d0, 0);
  assert(d0 < d1, "expected delay to increase with index");
  assert(d1 < d4, "expected delay to increase with index");
});

Deno.test("synapseStaggerDelay caps total at max stagger budget", () => {
  // A very large list should not exceed the max stagger budget.
  const lastDelay = synapseStaggerDelay(499, 500);
  assert(
    lastDelay <= TRANSITION_SYNAPSE_MAX_STAGGER_MS,
    `expected ${lastDelay} <= ${TRANSITION_SYNAPSE_MAX_STAGGER_MS}`,
  );
});

Deno.test("synapseStaggerDelay uses per-item stagger for small lists", () => {
  // With 3 items, the per-item delay is the base stagger (25 ms), since
  // 2 * 25 = 50 < 250 max.
  const d2 = synapseStaggerDelay(2, 3);
  assertEquals(d2, 2 * TRANSITION_SYNAPSE_STAGGER_MS);
});
