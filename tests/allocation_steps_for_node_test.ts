/**
 * Tests for the shared inbound-allocation step rule (Issue #598).
 *
 * `allocationStepsForNode` is the single source of truth for turning a node's
 * raw inbound edges into ranked attribution steps: build the allocation input,
 * fetch the receiver's squash and recorded-activation envelope, keep only rows
 * with a finite positive `share`, and cap at `maxInboundPerNode`. The bounded
 * walk, the exhaustive DFS cache, the #559 benchmark and the exhaustive
 * reference walk all call it, so their per-hop shares cannot drift apart.
 */

import { approx, assert, assertEquals } from "./test_helpers.ts";

import { allocationStepsForNode } from "../docs/shared/graph_analysis.js";
import { computeInboundSynapseImpactAllocation } from "../docs/impact_attribution.js";

type Edge = {
  fromUuid: string;
  toUuid: string;
  weight: number;
  meanContribution?: number | null;
  contributions?: number[] | null;
};

function edge(
  fromUuid: string,
  weight: number,
  meanContribution: number | null = null,
  contributions: number[] | null = null,
): Edge {
  return { fromUuid, toUuid: "n1", weight, meanContribution, contributions };
}

Deno.test("allocationStepsForNode - ranks inbound edges by share", () => {
  const steps = allocationStepsForNode({
    uuid: "n1",
    inbound: [edge("a", 1, 1), edge("b", 1, 3)],
    getNeuronSquash: null,
    getRecordedActivationMax: null,
    maxInboundPerNode: 10,
  });

  assertEquals(steps.length, 2);
  assertEquals(steps[0].uuid, "b");
  approx(steps[0].share, 0.75);
  assertEquals(steps[1].uuid, "a");
  approx(steps[1].share, 0.25);
});

Deno.test("allocationStepsForNode - caps at maxInboundPerNode", () => {
  const inbound = [edge("a", 1, 4), edge("b", 1, 3), edge("c", 1, 2)];

  const capped = allocationStepsForNode({
    uuid: "n1",
    inbound,
    getNeuronSquash: null,
    getRecordedActivationMax: null,
    maxInboundPerNode: 2,
  });

  assertEquals(capped.length, 2);
  assertEquals(capped.map((s) => s.uuid).join(","), "a,b");
});

Deno.test("allocationStepsForNode - drops non-positive shares", () => {
  const steps = allocationStepsForNode({
    uuid: "n1",
    inbound: [edge("a", 1, 5), edge("zero", 0, 0)],
    getNeuronSquash: null,
    getRecordedActivationMax: null,
    maxInboundPerNode: 10,
  });

  assertEquals(steps.length, 1);
  assertEquals(steps[0].uuid, "a");
});

Deno.test("allocationStepsForNode - empty or missing inbound yields no steps", () => {
  const empty = allocationStepsForNode({
    uuid: "n1",
    inbound: [],
    getNeuronSquash: null,
    getRecordedActivationMax: null,
    maxInboundPerNode: 10,
  });
  assertEquals(empty.length, 0);

  const missing = allocationStepsForNode({
    uuid: "n1",
    inbound: null,
    getNeuronSquash: null,
    getRecordedActivationMax: null,
    maxInboundPerNode: 10,
  });
  assertEquals(missing.length, 0);
});

Deno.test("allocationStepsForNode - tolerates omitted envelope getters", () => {
  const steps = allocationStepsForNode({
    uuid: "n1",
    inbound: [edge("a", 1, 1), edge("b", 1, 1)],
    maxInboundPerNode: 10,
  });

  assertEquals(steps.length, 2);
  approx(steps[0].share, 0.5);
  approx(steps[1].share, 0.5);
});

Deno.test("allocationStepsForNode - fetches the receiver's squash envelope", () => {
  const squashCalls: string[] = [];
  const maxCalls: string[] = [];

  // A MAXIMUM receiver allocates by argmax win fraction (#513): `b` wins both
  // observations, so an additive 50/50 split becomes 100/0 — proving both the
  // squash getter and the per-observation series reach the allocation.
  const steps = allocationStepsForNode({
    uuid: "n1",
    inbound: [edge("a", 1, 1, [0.1, 0.2]), edge("b", 1, 1, [0.9, 0.8])],
    getNeuronSquash: (uuid: string) => {
      squashCalls.push(uuid);
      return "MAXIMUM";
    },
    getRecordedActivationMax: (uuid: string) => {
      maxCalls.push(uuid);
      return 1;
    },
    maxInboundPerNode: 10,
  });

  assertEquals(squashCalls.join(","), "n1");
  assertEquals(maxCalls.join(","), "n1");
  assertEquals(steps.length, 1);
  assertEquals(steps[0].uuid, "b");
  approx(steps[0].share, 1);
});

Deno.test("allocationStepsForNode - matches a direct allocation call", () => {
  const inbound = [
    edge("a", 0.5, 2, [0.4, 0.6]),
    edge("b", -1.5, null, [0.1, 0.2]),
    edge("c", 2, 1, null),
  ];

  const expected = computeInboundSynapseImpactAllocation({
    toUuid: "n1",
    neuronImpact: null,
    inboundSynapses: inbound,
    toNeuronSquash: "TANH",
    recordedActivationMax: 0.8,
  }).synapses
    .filter((r) => isFinite(r.share) && r.share > 0)
    .slice(0, 2)
    .map((r) => ({ uuid: r.fromUuid, share: r.share }));

  const steps = allocationStepsForNode({
    uuid: "n1",
    inbound,
    getNeuronSquash: () => "TANH",
    getRecordedActivationMax: () => 0.8,
    maxInboundPerNode: 2,
  });

  assert(expected.length > 0, "fixture should produce steps");
  assertEquals(JSON.stringify(steps), JSON.stringify(expected));
});
