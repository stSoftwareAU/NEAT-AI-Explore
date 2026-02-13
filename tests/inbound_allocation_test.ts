import { approx, assert } from "./test_helpers.ts";

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
