/**
 * Integration tests for selection-squash allocation (Issue #513).
 *
 * Verifies that `computeInboundSynapseImpactAllocation` and the multi-hop walk
 * `computeTopContributingInputs` attribute inbound share by *win fraction* at
 * MINIMUM/MAXIMUM neurons instead of the additive `|meanContribution|` share.
 *
 * Australian English note: prefer spellings like "behaviour", "colour".
 */

import { approx, assert, assertEquals } from "./test_helpers.ts";

import { computeInboundSynapseImpactAllocation } from "../docs/impact_attribution.js";
import { computeTopContributingInputs } from "../docs/shared/graph_analysis.js";

// ---------------------------------------------------------------------------
// computeInboundSynapseImpactAllocation: MINIMUM
// ---------------------------------------------------------------------------

Deno.test("MINIMUM allocation credits share by win fraction, not additive magnitude", () => {
  // Reproduces the issue: `volume` has a much larger mean contribution but it
  // rarely binds the min (liquid stocks). Additive allocation would credit
  // volume ~99%; win-fraction credits it ~10%.
  // price is the smaller (winning) value on 9 of 10 observations.
  const price = [-0.9, -0.9, -0.9, -0.9, -0.9, -0.9, -0.9, -0.9, -0.9, 0.9];
  const volume = [0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8];

  const res = computeInboundSynapseImpactAllocation({
    toUuid: "output-0",
    neuronImpact: 1,
    toNeuronSquash: "MINIMUM",
    inboundSynapses: [
      {
        fromUuid: "price",
        toUuid: "output-0",
        weight: 1,
        // Deliberately small additive magnitude for the winner...
        meanContribution: 0.1,
        contributions: price,
      },
      {
        fromUuid: "volume",
        toUuid: "output-0",
        weight: 1,
        // ...and large additive magnitude for the rare winner.
        meanContribution: 0.8,
        contributions: volume,
      },
    ],
  });

  assertEquals(res.selectionKind, "MINIMUM");
  assert(!res.selectionFallback);

  const byFrom = new Map(res.synapses.map((s) => [s.fromUuid, s]));
  const priceRow = byFrom.get("price")!;
  const volumeRow = byFrom.get("volume")!;

  // Win-fraction share (not additive 0.1/0.9 vs 0.8/0.9).
  approx(priceRow.share, 0.9);
  approx(volumeRow.share, 0.1);
  approx(priceRow.selectionWinShare ?? -1, 0.9);

  // Pre-gate (additive) share preserved for the badge: 0.1/0.9 and 0.8/0.9.
  approx(priceRow.preGateShare ?? -1, 0.1 / 0.9);
  approx(volumeRow.preGateShare ?? -1, 0.8 / 0.9);

  // Allocated impact follows the win-fraction share.
  approx(priceRow.allocatedImpact ?? 0, 0.9);
  approx(volumeRow.allocatedImpact ?? 0, 0.1);
});

Deno.test("MINIMUM allocation surfaces a pre-gate badge only when selection reduced the share", () => {
  const price = [-0.9, -0.9, -0.9, -0.9, -0.9, -0.9, -0.9, -0.9, -0.9, 0.9];
  const volume = [0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8];
  const res = computeInboundSynapseImpactAllocation({
    toUuid: "output-0",
    neuronImpact: 1,
    toNeuronSquash: "MINIMUM",
    inboundSynapses: [
      {
        fromUuid: "price",
        toUuid: "output-0",
        weight: 1,
        meanContribution: 0.8,
        contributions: price,
      },
      {
        fromUuid: "volume",
        toUuid: "output-0",
        weight: 1,
        meanContribution: 0.8,
        contributions: volume,
      },
    ],
  });
  const byFrom = new Map(res.synapses.map((s) => [s.fromUuid, s]));
  // volume: additive 0.5 → win 0.1 → gate-masked > 0 (badge shows).
  approx(byFrom.get("volume")!.gateMaskedFraction, 1 - 0.1 / 0.5);
  // price: additive 0.5 → win 0.9 → not reduced → no masking.
  approx(byFrom.get("price")!.gateMaskedFraction, 0);
});

Deno.test("selection allocation falls back to even split with a flag when contributions absent", () => {
  const res = computeInboundSynapseImpactAllocation({
    toUuid: "output-0",
    neuronImpact: 1,
    toNeuronSquash: "MINIMUM",
    inboundSynapses: [
      { fromUuid: "a", toUuid: "output-0", weight: 1, meanContribution: 5 },
      { fromUuid: "b", toUuid: "output-0", weight: 1, meanContribution: 1 },
    ],
  });
  assertEquals(res.selectionKind, "MINIMUM");
  assert(res.selectionFallback);
  const byFrom = new Map(res.synapses.map((s) => [s.fromUuid, s]));
  approx(byFrom.get("a")!.share, 0.5);
  approx(byFrom.get("b")!.share, 0.5);
});

Deno.test("non-selection squash keeps the additive share (regression guard)", () => {
  const res = computeInboundSynapseImpactAllocation({
    toUuid: "hidden-x",
    neuronImpact: 1,
    toNeuronSquash: "TANH",
    inboundSynapses: [
      {
        fromUuid: "a",
        toUuid: "hidden-x",
        weight: 1,
        meanContribution: 8,
        contributions: [0, 0, 0],
      },
      {
        fromUuid: "b",
        toUuid: "hidden-x",
        weight: 1,
        meanContribution: 2,
        contributions: [9, 9, 9],
      },
    ],
  });
  assertEquals(res.selectionKind, null);
  const byFrom = new Map(res.synapses.map((s) => [s.fromUuid, s]));
  approx(byFrom.get("a")!.share, 0.8);
  approx(byFrom.get("b")!.share, 0.2);
  assertEquals(byFrom.get("a")!.selectionWinShare ?? null, null);
});

// ---------------------------------------------------------------------------
// computeTopContributingInputs: the walk propagates win-fraction share
// ---------------------------------------------------------------------------

Deno.test("walk attributes MINIMUM output to the operand that usually binds the min", () => {
  // Graph: input-price → output-0, input-volume → output-0, output-0 = MIN.
  const edges: Record<
    string,
    Array<
      {
        fromUuid: string;
        toUuid: string;
        weight: number;
        meanContribution: number;
        contributions: number[];
      }
    >
  > = {
    "output-0": [
      {
        fromUuid: "input-price",
        toUuid: "output-0",
        weight: 1,
        meanContribution: 0.1, // small additive magnitude...
        contributions: [-1, -1, -1, -1, -1, -1, -1, -1, -1, 1], // wins 9/10
      },
      {
        fromUuid: "input-volume",
        toUuid: "output-0",
        weight: 1,
        meanContribution: 0.9, // ...large additive magnitude, rare winner
        contributions: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // wins 1/10
      },
    ],
  };

  const res = computeTopContributingInputs({
    focusUuid: "output-0",
    getInboundEdges: (toUuid) => edges[toUuid] ?? [],
    getNeuronSquash: (uuid) => (uuid === "output-0" ? "MINIMUM" : null),
  });

  const byUuid = new Map(res.inputs.map((r) => [r.uuid, r]));
  const price = byUuid.get("input-price")!;
  const volume = byUuid.get("input-volume")!;
  // price should dominate (~0.9) rather than volume (~0.9 under additive).
  assert(price.score > volume.score, "price must outrank volume");
  approx(price.score, 0.9);
  approx(volume.score, 0.1);
});
