/**
 * Tests for the downstream `min(...)` gate awareness in the influence calc.
 *
 * Issue #272 — when the consumer contract describes a downstream gate that
 * combines several inputs via `min`, an input is only "influential" on the
 * samples where its value is strictly less than every other gate operand.
 * The calc records `gateMaskedFraction` (0..1) and `effectiveShare`
 * (post-gate share) alongside the existing pre-gate `share` so the UI can
 * display both for diagnostics.
 *
 * Australian English note: prefer spellings like "behaviour", "colour".
 */

import { approx, assert, assertEquals } from "./test_helpers.ts";

import { computeInboundSynapseImpactAllocation } from "../docs/impact_attribution.js";
import {
  computeInputActiveFraction,
  getGatesForInput,
  loadConsumerContract,
} from "../docs/shared/consumer_contract.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal snapshot exposing per-input activations under
 * `recording.neurons[uuid].activation`, plus an optional embedded
 * `creature.consumerContract`.
 */
function makeSnapshot(
  activationsByUuid: Record<string, number[]>,
  embeddedContract: unknown = null,
) {
  const recordingNeurons: Record<string, { activation: number[] }> = {};
  for (const [uuid, arr] of Object.entries(activationsByUuid)) {
    recordingNeurons[uuid] = { activation: arr };
  }
  return {
    creature: {
      neurons: Object.keys(activationsByUuid).map((uuid) => ({
        uuid,
        type: uuid.startsWith("input-") ? "input" : "hidden",
        squash: "IDENTITY",
        bias: 0,
      })),
      synapses: [],
      input:
        Object.keys(activationsByUuid).filter((u) => u.startsWith("input-"))
          .length,
      output: 0,
      ...(embeddedContract ? { consumerContract: embeddedContract } : {}),
    },
    recording: { neurons: recordingNeurons },
  };
}

// ---------------------------------------------------------------------------
// loadConsumerContract + getGatesForInput basics
// ---------------------------------------------------------------------------

Deno.test("loadConsumerContract reads an embedded creature.consumerContract", () => {
  const snap = makeSnapshot({ "input-a": [1, 2, 3], "input-b": [4, 5, 6] }, {
    gates: [{
      kind: "min",
      inputs: ["input-a", "input-b"],
      regimeQuantile: "p05",
    }],
  });
  const contract = loadConsumerContract(snap);
  assert(contract !== null, "expected an embedded contract to load");
  assertEquals(contract!.gates.length, 1);
  assertEquals(contract!.gates[0].kind, "min");
  assertEquals(contract!.gates[0].inputs.length, 2);
});

Deno.test("loadConsumerContract prefers the explicit contractJson argument", () => {
  const snap = makeSnapshot({ "input-a": [1], "input-b": [2] });
  const contract = loadConsumerContract(snap, {
    gates: [{ kind: "min", inputs: ["input-a", "input-b"] }],
  });
  assert(contract !== null);
  assertEquals(contract!.gates.length, 1);
});

Deno.test("loadConsumerContract returns null when no contract is provided", () => {
  const snap = makeSnapshot({ "input-a": [1] });
  assertEquals(loadConsumerContract(snap), null);
  assertEquals(loadConsumerContract(snap, null), null);
});

Deno.test("loadConsumerContract drops gates with unsupported kind or fewer than two inputs", () => {
  const snap = makeSnapshot({ "input-a": [1], "input-b": [2] });
  const contract = loadConsumerContract(snap, {
    gates: [
      { kind: "min", inputs: ["input-a"] }, // too few inputs
      { kind: "max", inputs: ["input-a", "input-b"] }, // unsupported kind
      { kind: "min", inputs: ["input-a", "input-b"] }, // keeper
    ],
  });
  assert(contract !== null);
  assertEquals(contract!.gates.length, 1);
});

Deno.test("getGatesForInput returns only the gates that reference the input", () => {
  const snap = makeSnapshot({
    "input-a": [1],
    "input-b": [2],
    "input-c": [3],
  });
  const contract = loadConsumerContract(snap, {
    gates: [
      { kind: "min", inputs: ["input-a", "input-b"] },
      { kind: "min", inputs: ["input-b", "input-c"] },
    ],
  });
  assert(contract !== null);
  assertEquals(getGatesForInput(contract, "input-a").length, 1);
  assertEquals(getGatesForInput(contract, "input-b").length, 2);
  assertEquals(getGatesForInput(contract, "input-c").length, 1);
  assertEquals(getGatesForInput(contract, "input-missing").length, 0);
});

// ---------------------------------------------------------------------------
// computeInputActiveFraction
// ---------------------------------------------------------------------------

Deno.test("computeInputActiveFraction: input is min 100% of the time → 1.0", () => {
  const snap = makeSnapshot({
    "input-a": [1, 1, 1, 1],
    "input-b": [10, 10, 10, 10],
  });
  const contract = loadConsumerContract(snap, {
    gates: [{ kind: "min", inputs: ["input-a", "input-b"] }],
  });
  approx(computeInputActiveFraction(contract!, "input-a"), 1.0);
  approx(computeInputActiveFraction(contract!, "input-b"), 0.0);
});

Deno.test("computeInputActiveFraction: input is min 30% of the time → 0.3", () => {
  // input-a is strictly less than input-b on indices 0, 1, 2 (3 of 10).
  const a = [0, 0, 0, 5, 5, 5, 5, 5, 5, 5];
  const b = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
  const snap = makeSnapshot({ "input-a": a, "input-b": b });
  const contract = loadConsumerContract(snap, {
    gates: [{ kind: "min", inputs: ["input-a", "input-b"] }],
  });
  approx(computeInputActiveFraction(contract!, "input-a"), 0.3);
});

// ---------------------------------------------------------------------------
// computeInboundSynapseImpactAllocation: min-gate masking
// ---------------------------------------------------------------------------

Deno.test("inbound allocation: input that is min 100% keeps full effectiveShare", () => {
  const snap = makeSnapshot({
    "input-a": [1, 1, 1, 1],
    "input-b": [10, 10, 10, 10],
  });
  const contract = loadConsumerContract(snap, {
    gates: [{ kind: "min", inputs: ["input-a", "input-b"] }],
  });
  const res = computeInboundSynapseImpactAllocation({
    toUuid: "hidden-x",
    neuronImpact: 1,
    inboundSynapses: [
      {
        fromUuid: "input-a",
        toUuid: "hidden-x",
        weight: 1,
        meanContribution: 1,
      },
    ],
    consumerContract: contract,
  });
  const row = res.synapses[0];
  approx(row.share, 1);
  approx(row.effectiveShare ?? -1, 1);
  approx(row.gateMaskedFraction ?? -1, 0);
});

Deno.test("inbound allocation: input that is min 0% has effectiveShare = 0", () => {
  const snap = makeSnapshot({
    "input-a": [10, 10, 10, 10],
    "input-b": [1, 1, 1, 1],
  });
  const contract = loadConsumerContract(snap, {
    gates: [{ kind: "min", inputs: ["input-a", "input-b"] }],
  });
  const res = computeInboundSynapseImpactAllocation({
    toUuid: "hidden-x",
    neuronImpact: 1,
    inboundSynapses: [
      {
        fromUuid: "input-a",
        toUuid: "hidden-x",
        weight: 1,
        meanContribution: 1,
      },
    ],
    consumerContract: contract,
  });
  const row = res.synapses[0];
  approx(row.share, 1, 1e-9, "pre-gate share is unaffected");
  approx(row.effectiveShare ?? -1, 0);
  approx(row.gateMaskedFraction ?? -1, 1);
});

Deno.test("inbound allocation: partial gating (30%) scales effectiveShare linearly", () => {
  const a = [0, 0, 0, 5, 5, 5, 5, 5, 5, 5];
  const b = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
  const snap = makeSnapshot({ "input-a": a, "input-b": b });
  const contract = loadConsumerContract(snap, {
    gates: [{ kind: "min", inputs: ["input-a", "input-b"] }],
  });
  const res = computeInboundSynapseImpactAllocation({
    toUuid: "hidden-x",
    neuronImpact: 1,
    inboundSynapses: [
      {
        fromUuid: "input-a",
        toUuid: "hidden-x",
        weight: 1,
        meanContribution: 2,
      },
      {
        fromUuid: "hidden-z",
        toUuid: "hidden-x",
        weight: 1,
        meanContribution: 8,
      },
    ],
    consumerContract: contract,
  });
  const byFrom = new Map(res.synapses.map((s) => [s.fromUuid, s]));
  const a_row = byFrom.get("input-a")!;
  const z_row = byFrom.get("hidden-z")!;
  // Pre-gate shares are scores normalised: 2/10 and 8/10.
  approx(a_row.share, 0.2);
  approx(z_row.share, 0.8);
  // input-a is min 30% of samples → effectiveShare scales.
  approx(a_row.effectiveShare ?? -1, 0.2 * 0.3);
  approx(a_row.gateMaskedFraction ?? -1, 0.7);
  // hidden-z is not an input — no gate applies.
  approx(z_row.effectiveShare ?? -1, 0.8);
  approx(z_row.gateMaskedFraction ?? -1, 0);
});

// ---------------------------------------------------------------------------
// Regression guard: no contract → identical output to the squash-only baseline
// ---------------------------------------------------------------------------

Deno.test("inbound allocation: no contract supplied → behaviour is unchanged", () => {
  const inbound = [
    {
      fromUuid: "input-a",
      toUuid: "hidden-x",
      weight: 2,
      meanContribution: 10,
    },
    {
      fromUuid: "input-b",
      toUuid: "hidden-x",
      weight: -3,
      meanContribution: -5,
    },
  ];
  const baseline = computeInboundSynapseImpactAllocation({
    toUuid: "hidden-x",
    neuronImpact: 0.5,
    inboundSynapses: inbound,
  });
  const withoutContract = computeInboundSynapseImpactAllocation({
    toUuid: "hidden-x",
    neuronImpact: 0.5,
    inboundSynapses: inbound,
    consumerContract: null,
  });
  assertEquals(withoutContract.synapses.length, baseline.synapses.length);
  for (let i = 0; i < baseline.synapses.length; i++) {
    const a = baseline.synapses[i];
    const b = withoutContract.synapses[i];
    approx(a.share, b.share);
    approx(a.allocatedImpact ?? 0, b.allocatedImpact ?? 0);
    // Without a contract the new diagnostics mirror share (no masking).
    approx(b.effectiveShare ?? -1, b.share);
    approx(b.gateMaskedFraction ?? -1, 0);
  }
});

// ---------------------------------------------------------------------------
// Contract referencing inputs not in the snapshot is gracefully ignored
// ---------------------------------------------------------------------------

Deno.test("inbound allocation: contract references missing input → ignored, no throw", () => {
  const snap = makeSnapshot({ "input-a": [1, 2, 3] });
  // input-missing has no recording — the gate cannot be evaluated and should
  // collapse to unmasked behaviour for input-a.
  const contract = loadConsumerContract(snap, {
    gates: [{ kind: "min", inputs: ["input-a", "input-missing"] }],
  });
  assert(contract !== null);

  const res = computeInboundSynapseImpactAllocation({
    toUuid: "hidden-x",
    neuronImpact: 1,
    inboundSynapses: [
      {
        fromUuid: "input-a",
        toUuid: "hidden-x",
        weight: 1,
        meanContribution: 1,
      },
    ],
    consumerContract: contract,
  });
  const row = res.synapses[0];
  approx(row.share, 1);
  approx(row.effectiveShare ?? -1, 1);
  approx(row.gateMaskedFraction ?? -1, 0);
});
