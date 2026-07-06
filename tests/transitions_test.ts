/**
 * Tests for docs/shared/transitions.js (#104).
 *
 * Validates exported duration constants and helper functions.
 */

import { assert, assertEquals } from "./test_helpers.ts";

import {
  CAMERA_FLY_MS,
  FOCUS_PULSE_MS,
  PANEL_CROSSFADE_MS,
  prefersReducedMotion,
  SYNAPSE_FADE_MS,
  SYNAPSE_STAGGER_CAP_MS,
  SYNAPSE_STAGGER_MS,
  synapseStaggerDelay,
} from "../docs/shared/transitions.js";

// ── Duration constants ──────────────────────────────────────────────────────

Deno.test("all durations are positive numbers", () => {
  for (
    const val of [
      PANEL_CROSSFADE_MS,
      SYNAPSE_STAGGER_MS,
      SYNAPSE_STAGGER_CAP_MS,
      SYNAPSE_FADE_MS,
      CAMERA_FLY_MS,
      FOCUS_PULSE_MS,
    ]
  ) {
    assertEquals(typeof val, "number");
    assert(val > 0, `Expected positive duration, got ${val}`);
  }
});

Deno.test("all durations are at most 300 ms (performance guardrail)", () => {
  // SYNAPSE_STAGGER_CAP_MS is a total cap across all items, not a single
  // animation duration, so it is excluded from the per-animation limit.
  for (
    const val of [
      PANEL_CROSSFADE_MS,
      SYNAPSE_FADE_MS,
      CAMERA_FLY_MS,
      FOCUS_PULSE_MS,
    ]
  ) {
    assert(val <= 300, `Duration ${val} ms exceeds 300 ms limit`);
  }
});

// ── prefersReducedMotion ────────────────────────────────────────────────────

Deno.test("prefersReducedMotion returns false in Deno (no matchMedia)", () => {
  // Deno has no window.matchMedia, so the helper should gracefully return false.
  assertEquals(prefersReducedMotion(), false);
});

// ── synapseStaggerDelay ─────────────────────────────────────────────────────

Deno.test("synapseStaggerDelay returns 0 for first item", () => {
  assertEquals(synapseStaggerDelay(0, 10), 0);
});

Deno.test("synapseStaggerDelay returns 0 for single-item list", () => {
  assertEquals(synapseStaggerDelay(0, 1), 0);
});

Deno.test("synapseStaggerDelay returns 0 for empty list", () => {
  assertEquals(synapseStaggerDelay(0, 0), 0);
});

Deno.test("synapseStaggerDelay returns 0 for negative index", () => {
  assertEquals(synapseStaggerDelay(-1, 5), 0);
});

Deno.test("synapseStaggerDelay increases with index", () => {
  const d0 = synapseStaggerDelay(0, 5);
  const d1 = synapseStaggerDelay(1, 5);
  const d4 = synapseStaggerDelay(4, 5);
  assert(d1 > d0, "delay for index 1 should exceed index 0");
  assert(d4 > d1, "delay for index 4 should exceed index 1");
});

Deno.test("synapseStaggerDelay total never exceeds cap", () => {
  // Even with 1000 items, the last item's delay should not exceed the cap.
  const lastDelay = synapseStaggerDelay(999, 1000);
  assert(
    lastDelay <= SYNAPSE_STAGGER_CAP_MS,
    `Last delay ${lastDelay} exceeds cap ${SYNAPSE_STAGGER_CAP_MS}`,
  );
});

Deno.test("synapseStaggerDelay uses per-item step for small lists", () => {
  // With 3 items, the gap = SYNAPSE_STAGGER_MS per item (well under cap).
  const d1 = synapseStaggerDelay(1, 3);
  const d2 = synapseStaggerDelay(2, 3);
  // Each step should be SYNAPSE_STAGGER_MS (since 2 * 25 < 250 cap).
  assertEquals(d1, SYNAPSE_STAGGER_MS);
  assertEquals(d2, SYNAPSE_STAGGER_MS * 2);
});
