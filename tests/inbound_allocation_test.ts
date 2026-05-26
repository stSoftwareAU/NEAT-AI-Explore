import { approx, assert, assertEquals } from "./test_helpers.ts";

import { computeInboundSynapseImpactAllocation } from "../docs/impact_attribution.js";

Deno.test("computeInboundSynapseImpactAllocation allocates neuron impact across inbound synapses", () => {
  const res = computeInboundSynapseImpactAllocation({
    toUuid: "hidden-X",
    neuronImpact: 0.5,
    inboundSynapses: [
      { fromUuid: "a", toUuid: "hidden-X", weight: 2, meanContribution: 10 },
      { fromUuid: "b", toUuid: "hidden-X", weight: -3, meanContribution: -5 },
    ],
  });

  // Scores are |meanContribution|: 10 and 5 => shares 2/3 and 1/3.
  approx(res.totalScore, 15);
  assert(res.synapses.length === 2);

  const byFrom = new Map(res.synapses.map((s) => [s.fromUuid, s]));
  approx(byFrom.get("a")?.share ?? 0, 10 / 15);
  approx(byFrom.get("b")?.share ?? 0, 5 / 15);

  approx(byFrom.get("a")?.allocatedImpact ?? 0, 0.5 * (10 / 15));
  approx(byFrom.get("b")?.allocatedImpact ?? 0, 0.5 * (5 / 15));

  // Sum allocated impacts should equal neuron impact.
  approx(
    res.synapses.reduce((acc, s) => acc + (s.allocatedImpact ?? 0), 0),
    0.5,
  );
});

Deno.test("computeInboundSynapseImpactAllocation falls back to |weight| when meanContribution missing", () => {
  const res = computeInboundSynapseImpactAllocation({
    toUuid: "hidden-X",
    neuronImpact: 1,
    inboundSynapses: [
      { fromUuid: "a", toUuid: "hidden-X", weight: 2 },
      { fromUuid: "b", toUuid: "hidden-X", weight: -1 },
    ],
  });

  // Scores: |2| and |1| => shares 2/3 and 1/3.
  approx(res.totalScore, 3);
  const byFrom = new Map(res.synapses.map((s) => [s.fromUuid, s]));
  approx(byFrom.get("a")?.allocatedImpact ?? 0, 2 / 3);
  approx(byFrom.get("b")?.allocatedImpact ?? 0, 1 / 3);
});

// -- Squash-aware cap (issue #270) ------------------------------------------

Deno.test("computeInboundSynapseImpactAllocation: TANH receiver caps per-synapse influence so Σ ≤ 1", () => {
  // Ten inbound synapses each feeding meanContribution = 10. Raw Σ = 100,
  // which a TANH neuron cannot emit — its ceiling is 1. Each synapse should
  // then carry a fair share of the ceiling: ~0.1, summing to ≤ 1.0.
  const inbound = Array.from({ length: 10 }, (_, i) => ({
    fromUuid: `in-${i}`,
    toUuid: "hidden-tanh",
    weight: 1,
    meanContribution: 10,
  }));

  const res = computeInboundSynapseImpactAllocation({
    toUuid: "hidden-tanh",
    inboundSynapses: inbound,
    toNeuronSquash: "TANH",
  });

  approx(res.emitCeiling, 1);
  approx(res.totalScore, 100);
  assertEquals(res.synapses.length, 10);

  for (const s of res.synapses) {
    approx(s.allocatedImpact ?? 0, 0.1, 1e-9, `${s.fromUuid} expected ~0.1`);
  }
  const sum = res.synapses.reduce(
    (acc, s) => acc + (s.allocatedImpact ?? 0),
    0,
  );
  approx(sum, 1, 1e-9, "sum of allocated influence must be ≤ 1 for TANH");
  assert(sum <= 1 + 1e-9, "sum cannot exceed the emit ceiling");
});

Deno.test("computeInboundSynapseImpactAllocation: SIGMOID receiver with one strong synapse caps allocated impact at 1", () => {
  const res = computeInboundSynapseImpactAllocation({
    toUuid: "hidden-sig",
    inboundSynapses: [
      {
        fromUuid: "in-strong",
        toUuid: "hidden-sig",
        weight: 1,
        meanContribution: 50,
      },
    ],
    toNeuronSquash: "SIGMOID",
  });

  approx(res.emitCeiling, 1);
  const only = res.synapses[0];
  assert(only.allocatedImpact != null, "allocatedImpact must be set under cap");
  approx(only.allocatedImpact ?? 0, 1, 1e-9);
  assert(
    (only.allocatedImpact ?? 0) <= 1 + 1e-9,
    "single-synapse alloc cannot exceed 1 for SIGMOID",
  );
});

Deno.test("computeInboundSynapseImpactAllocation: RELU with no saturation falls back to current behaviour", () => {
  // RELU has no analytic ceiling; without a recorded activation envelope the
  // helper should behave as before (allocatedImpact = null when neuronImpact
  // is null, neuronImpact * share otherwise).
  const inbound = [
    { fromUuid: "a", toUuid: "hidden-relu", weight: 1, meanContribution: 2 },
    { fromUuid: "b", toUuid: "hidden-relu", weight: 1, meanContribution: 1 },
  ];

  const withoutImpact = computeInboundSynapseImpactAllocation({
    toUuid: "hidden-relu",
    inboundSynapses: inbound,
    toNeuronSquash: "RELU",
  });
  assertEquals(withoutImpact.emitCeiling, Number.POSITIVE_INFINITY);
  for (const s of withoutImpact.synapses) {
    assertEquals(
      s.allocatedImpact,
      null,
      "no impact, unbounded squash, no envelope ⇒ allocatedImpact stays null",
    );
  }

  const withImpact = computeInboundSynapseImpactAllocation({
    toUuid: "hidden-relu",
    neuronImpact: 0.5,
    inboundSynapses: inbound,
    toNeuronSquash: "RELU",
  });
  const byFrom = new Map(withImpact.synapses.map((s) => [s.fromUuid, s]));
  approx(byFrom.get("a")?.allocatedImpact ?? 0, 0.5 * (2 / 3));
  approx(byFrom.get("b")?.allocatedImpact ?? 0, 0.5 * (1 / 3));
});

Deno.test("computeInboundSynapseImpactAllocation: IDENTITY falls back to current behaviour without envelope", () => {
  const inbound = [
    {
      fromUuid: "a",
      toUuid: "hidden-id",
      weight: 1,
      meanContribution: 4,
    },
    {
      fromUuid: "b",
      toUuid: "hidden-id",
      weight: 1,
      meanContribution: 2,
    },
  ];

  const res = computeInboundSynapseImpactAllocation({
    toUuid: "hidden-id",
    neuronImpact: 0.9,
    inboundSynapses: inbound,
    toNeuronSquash: "IDENTITY",
  });

  assertEquals(res.emitCeiling, Number.POSITIVE_INFINITY);
  const byFrom = new Map(res.synapses.map((s) => [s.fromUuid, s]));
  approx(byFrom.get("a")?.allocatedImpact ?? 0, 0.9 * (4 / 6));
  approx(byFrom.get("b")?.allocatedImpact ?? 0, 0.9 * (2 / 6));
});

Deno.test("computeInboundSynapseImpactAllocation: RELU + recordedActivationMax tightens the cap", () => {
  // Raw Σ = 5; observed envelope is 2 ⇒ each synapse gets share * 2.
  const inbound = [
    { fromUuid: "a", toUuid: "hidden-relu", weight: 1, meanContribution: 3 },
    { fromUuid: "b", toUuid: "hidden-relu", weight: 1, meanContribution: 2 },
  ];

  const res = computeInboundSynapseImpactAllocation({
    toUuid: "hidden-relu",
    inboundSynapses: inbound,
    toNeuronSquash: "RELU",
    recordedActivationMax: 2,
  });

  approx(res.emitCeiling, 2);
  const byFrom = new Map(res.synapses.map((s) => [s.fromUuid, s]));
  approx(byFrom.get("a")?.allocatedImpact ?? 0, (3 / 5) * 2);
  approx(byFrom.get("b")?.allocatedImpact ?? 0, (2 / 5) * 2);
  const sum = res.synapses.reduce(
    (acc, s) => acc + (s.allocatedImpact ?? 0),
    0,
  );
  assert(sum <= 2 + 1e-9, "sum must not exceed recorded envelope");
});

Deno.test("computeInboundSynapseImpactAllocation: unknown squash falls back gracefully with no console output", () => {
  // Capture console activity to confirm no spam.
  const origWarn = console.warn;
  const origError = console.error;
  const origLog = console.log;
  let calls = 0;
  console.warn = (..._args: unknown[]) => calls++;
  console.error = (..._args: unknown[]) => calls++;
  console.log = (..._args: unknown[]) => calls++;

  try {
    const res = computeInboundSynapseImpactAllocation({
      toUuid: "hidden-x",
      neuronImpact: 0.5,
      inboundSynapses: [
        { fromUuid: "a", toUuid: "hidden-x", weight: 1, meanContribution: 2 },
        { fromUuid: "b", toUuid: "hidden-x", weight: 1, meanContribution: 1 },
      ],
      toNeuronSquash: "MYSTERY_SQUASH_v9",
    });
    assertEquals(res.emitCeiling, Number.POSITIVE_INFINITY);
    const byFrom = new Map(res.synapses.map((s) => [s.fromUuid, s]));
    approx(byFrom.get("a")?.allocatedImpact ?? 0, 0.5 * (2 / 3));
    approx(byFrom.get("b")?.allocatedImpact ?? 0, 0.5 * (1 / 3));
  } finally {
    console.warn = origWarn;
    console.error = origError;
    console.log = origLog;
  }

  assertEquals(calls, 0, "unknown squash must not log");
});

Deno.test("computeInboundSynapseImpactAllocation: neuronImpact magnitude is capped at the emit ceiling", () => {
  // neuronImpact = 5, but the receiving neuron is TANH (ceiling 1). The
  // total allocated impact magnitude must not exceed 1.
  const res = computeInboundSynapseImpactAllocation({
    toUuid: "hidden-tanh",
    neuronImpact: 5,
    inboundSynapses: [
      { fromUuid: "a", toUuid: "hidden-tanh", weight: 1, meanContribution: 1 },
      { fromUuid: "b", toUuid: "hidden-tanh", weight: 1, meanContribution: 1 },
    ],
    toNeuronSquash: "TANH",
  });

  const sum = res.synapses.reduce(
    (acc, s) => acc + (s.allocatedImpact ?? 0),
    0,
  );
  approx(sum, 1, 1e-9, "Σ allocatedImpact must be capped at TANH ceiling");
});
