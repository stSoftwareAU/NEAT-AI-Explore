/**
 * Tests for selection-squash attribution (Issue #513).
 *
 * MINIMUM/MAXIMUM/IF neurons select one operand per observation, so their
 * inbound share is a *win fraction*, not the additive `|meanContribution|`.
 *
 * Australian English note: prefer spellings like "behaviour", "colour".
 */

import { approx, assert, assertEquals } from "./test_helpers.ts";

import {
  computeSelectionWinShares,
  normaliseSelectionSquash,
} from "../docs/shared/selection_attribution.js";

// ---------------------------------------------------------------------------
// normaliseSelectionSquash
// ---------------------------------------------------------------------------

Deno.test("normaliseSelectionSquash maps aliases and lower/upper case", () => {
  assertEquals(normaliseSelectionSquash("MINIMUM"), "MINIMUM");
  assertEquals(normaliseSelectionSquash("min"), "MINIMUM");
  assertEquals(normaliseSelectionSquash(" Max "), "MAXIMUM");
  assertEquals(normaliseSelectionSquash("MAXIMUM"), "MAXIMUM");
  assertEquals(normaliseSelectionSquash("if"), "IF");
});

Deno.test("normaliseSelectionSquash returns null for non-selection squashes", () => {
  assertEquals(normaliseSelectionSquash("TANH"), null);
  assertEquals(normaliseSelectionSquash("SIGMOID"), null);
  assertEquals(normaliseSelectionSquash("IDENTITY"), null);
  assertEquals(normaliseSelectionSquash(""), null);
  assertEquals(normaliseSelectionSquash(null), null);
  assertEquals(normaliseSelectionSquash(undefined), null);
  assertEquals(normaliseSelectionSquash(42), null);
});

// ---------------------------------------------------------------------------
// computeSelectionWinShares — MINIMUM
// ---------------------------------------------------------------------------

Deno.test("MINIMUM: win fraction reflects how often each operand binds the min", () => {
  // The issue's scenario: operand `price` binds the min ~90% of the time; the
  // large-magnitude `volume` operand only binds it 10% (liquid stocks).
  // price contribution is the smaller value on 9 of 10 observations.
  const price = [0, 0, 0, 0, 0, 0, 0, 0, 0, 5];
  const volume = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
  const res = computeSelectionWinShares({
    squash: "MINIMUM",
    operands: [{ contributions: price }, { contributions: volume }],
  });
  assertEquals(res.kind, "MINIMUM");
  assert(!res.fallback);
  assertEquals(res.sampleCount, 10);
  approx(res.shares[0], 0.9); // price
  approx(res.shares[1], 0.1); // volume
});

Deno.test("MINIMUM: single operand always wins → share 1", () => {
  const res = computeSelectionWinShares({
    squash: "MINIMUM",
    operands: [{ contributions: [3, 2, 1] }],
  });
  approx(res.shares[0], 1);
  assertEquals(res.sampleCount, 3);
});

// ---------------------------------------------------------------------------
// computeSelectionWinShares — MAXIMUM
// ---------------------------------------------------------------------------

Deno.test("MAXIMUM: win fraction uses argmax of the contribution series", () => {
  const a = [10, 10, 0]; // wins first two observations
  const b = [1, 1, 100]; // wins the last
  const res = computeSelectionWinShares({
    squash: "MAXIMUM",
    operands: [{ contributions: a }, { contributions: b }],
  });
  assertEquals(res.kind, "MAXIMUM");
  approx(res.shares[0], 2 / 3);
  approx(res.shares[1], 1 / 3);
});

// ---------------------------------------------------------------------------
// Ties and non-finite handling
// ---------------------------------------------------------------------------

Deno.test("ties split the win equally across tied operands", () => {
  const a = [1, 1];
  const b = [1, 5];
  const res = computeSelectionWinShares({
    squash: "MINIMUM",
    operands: [{ contributions: a }, { contributions: b }],
  });
  // Observation 0: tie (both 1) → 0.5 each. Observation 1: a=1 wins.
  // a wins 1.5/2, b wins 0.5/2.
  approx(res.shares[0], 0.75);
  approx(res.shares[1], 0.25);
});

Deno.test("non-finite operand values are skipped for that observation", () => {
  const a = [NaN, 1, 1];
  const b = [2, 2, 2];
  const res = computeSelectionWinShares({
    squash: "MINIMUM",
    operands: [{ contributions: a }, { contributions: b }],
  });
  // Observation 0: a is NaN → only b finite → b wins.
  // Observations 1,2: a=1 < b=2 → a wins.
  // counted = 3, a wins 2, b wins 1.
  assertEquals(res.sampleCount, 3);
  approx(res.shares[0], 2 / 3);
  approx(res.shares[1], 1 / 3);
});

Deno.test("observation where every operand is non-finite is not counted", () => {
  const a = [NaN, 1];
  const b = [Infinity, 2];
  const res = computeSelectionWinShares({
    squash: "MINIMUM",
    operands: [{ contributions: a }, { contributions: b }],
  });
  assertEquals(res.sampleCount, 1);
  approx(res.shares[0], 1);
  approx(res.shares[1], 0);
});

// ---------------------------------------------------------------------------
// Fallbacks: even split
// ---------------------------------------------------------------------------

Deno.test("even-split fallback when any operand lacks contributions", () => {
  const res = computeSelectionWinShares({
    squash: "MINIMUM",
    operands: [{ contributions: [1, 2] }, { contributions: null }],
  });
  assert(res.fallback);
  approx(res.shares[0], 0.5);
  approx(res.shares[1], 0.5);
  assertEquals(res.sampleCount, 0);
});

Deno.test("IF always falls back to an even split (roles not identifiable)", () => {
  const res = computeSelectionWinShares({
    squash: "IF",
    operands: [
      { contributions: [1, 2, 3] },
      { contributions: [4, 5, 6] },
      { contributions: [7, 8, 9] },
    ],
  });
  assertEquals(res.kind, "IF");
  assert(res.fallback);
  approx(res.shares[0], 1 / 3);
  approx(res.shares[1], 1 / 3);
  approx(res.shares[2], 1 / 3);
});

Deno.test("empty operands and non-selection squash return empty shares", () => {
  const empty = computeSelectionWinShares({ squash: "MINIMUM", operands: [] });
  assertEquals(empty.shares.length, 0);
  const notSel = computeSelectionWinShares({
    squash: "TANH",
    operands: [{ contributions: [1] }],
  });
  assertEquals(notSel.kind, null);
  assertEquals(notSel.shares.length, 0);
});

Deno.test("ragged series use the shortest length as the denominator", () => {
  const a = [0, 0, 0, 0];
  const b = [1, 1]; // shorter → only 2 observations counted
  const res = computeSelectionWinShares({
    squash: "MINIMUM",
    operands: [{ contributions: a }, { contributions: b }],
  });
  assertEquals(res.sampleCount, 2);
  approx(res.shares[0], 1);
  approx(res.shares[1], 0);
});
