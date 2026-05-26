/**
 * Multi-hop observation attribution walk tests for output neurons.
 *
 * Reinforces the contract expected by issue #185: when
 * `computeTopContributingInputs` is called for an output neuron it must sum
 * contribution share across all upstream paths, terminate on recurrent
 * graphs, reach inputs across deep chains, and handle the trivial
 * direct-input case correctly.
 */

import { approx, assert, assertEquals } from "./test_helpers.ts";

import { computeTopContributingInputs } from "../docs/shared/graph_analysis.js";

type Edge = {
  fromUuid: string;
  toUuid: string;
  weight: number;
  meanContribution: number;
};

function inboundLookup(
  inbound: Record<string, Edge[]>,
): (toUuid: string) => Edge[] {
  return (toUuid: string) => inbound[toUuid] ?? [];
}

Deno.test("observation contributions: multiple paths to the same input sum correctly", () => {
  // Two hidden neurons each reach the same input. Their attributions must
  // accumulate rather than being treated as a single path.
  const inbound: Record<string, Edge[]> = {
    "output-0": [
      {
        fromUuid: "hidden-A",
        toUuid: "output-0",
        weight: 1,
        meanContribution: 1,
      },
      {
        fromUuid: "hidden-B",
        toUuid: "output-0",
        weight: 1,
        meanContribution: 1,
      },
    ],
    "hidden-A": [
      {
        fromUuid: "input-shared",
        toUuid: "hidden-A",
        weight: 1,
        meanContribution: 1,
      },
    ],
    "hidden-B": [
      {
        fromUuid: "input-shared",
        toUuid: "hidden-B",
        weight: 1,
        meanContribution: 1,
      },
    ],
  };

  const res = computeTopContributingInputs({
    focusUuid: "output-0",
    getInboundEdges: inboundLookup(inbound),
    exhaustive: true,
  });

  assert(!res.truncated, "walk should not truncate on a four-node graph");
  assertEquals(res.inputs.length, 1, "only one distinct input exists");
  const only = res.inputs[0];
  assertEquals(only.uuid, "input-shared");
  // Both paths contribute, normalised share must sum to 1.
  approx(only.score, 1, 1e-9, "single input must receive the full share");
});

Deno.test("observation contributions: cycles are finite and deterministic", () => {
  // hidden-A <-> hidden-B form a back-edge; without cycle handling the walk
  // would otherwise loop on the recurrent connection.
  const inbound: Record<string, Edge[]> = {
    "output-0": [
      {
        fromUuid: "hidden-A",
        toUuid: "output-0",
        weight: 1,
        meanContribution: 1,
      },
    ],
    "hidden-A": [
      {
        fromUuid: "input-0",
        toUuid: "hidden-A",
        weight: 1,
        meanContribution: 1,
      },
      {
        fromUuid: "hidden-B",
        toUuid: "hidden-A",
        weight: 1,
        meanContribution: 1,
      },
    ],
    "hidden-B": [
      {
        fromUuid: "hidden-A",
        toUuid: "hidden-B",
        weight: 1,
        meanContribution: 1,
      },
    ],
  };

  // Termination is enforced by the Deno test runner's own timeout — a real
  // infinite loop would never reach the assertions below. Wall-clock timing
  // budgets belong in a benchmark, not in a unit test (see issue #264).
  const res = computeTopContributingInputs({
    focusUuid: "output-0",
    getInboundEdges: inboundLookup(inbound),
    exhaustive: true,
  });

  // Only input-0 is reachable; hidden-B is a dead-end cycle that loops back
  // through hidden-A (a node already on the path) so it contributes 0.
  assertEquals(res.inputs.length, 1, "only input-0 should be reached");
  assertEquals(res.inputs[0].uuid, "input-0");
  approx(res.inputs[0].score, 1, 1e-9);

  // Determinism: running the walk again returns identical output.
  const second = computeTopContributingInputs({
    focusUuid: "output-0",
    getInboundEdges: inboundLookup(inbound),
    exhaustive: true,
  });
  assertEquals(
    JSON.stringify(second.inputs),
    JSON.stringify(res.inputs),
    "walk on a cycle must be deterministic across runs",
  );
});

Deno.test("observation contributions: deep chains still reach the input", () => {
  // Chain length 5: output -> h1 -> h2 -> h3 -> h4 -> input-deep
  const inbound: Record<string, Edge[]> = {
    "output-0": [{
      fromUuid: "h1",
      toUuid: "output-0",
      weight: 1,
      meanContribution: 1,
    }],
    "h1": [{
      fromUuid: "h2",
      toUuid: "h1",
      weight: 1,
      meanContribution: 1,
    }],
    "h2": [{
      fromUuid: "h3",
      toUuid: "h2",
      weight: 1,
      meanContribution: 1,
    }],
    "h3": [{
      fromUuid: "h4",
      toUuid: "h3",
      weight: 1,
      meanContribution: 1,
    }],
    "h4": [{
      fromUuid: "input-deep",
      toUuid: "h4",
      weight: 1,
      meanContribution: 1,
    }],
  };

  const res = computeTopContributingInputs({
    focusUuid: "output-0",
    getInboundEdges: inboundLookup(inbound),
    exhaustive: true,
  });

  assert(!res.truncated, "five-hop chain should not truncate");
  assertEquals(res.inputs.length, 1);
  assertEquals(res.inputs[0].uuid, "input-deep");
  approx(res.inputs[0].score, 1, 1e-9);
  // The recorded path includes every hop.
  assertEquals(
    res.inputs[0].path[res.inputs[0].path.length - 1],
    "output-0",
    "path must end at the focus output neuron",
  );
  assert(
    res.inputs[0].path.includes("h1") &&
      res.inputs[0].path.includes("h2") &&
      res.inputs[0].path.includes("h3") &&
      res.inputs[0].path.includes("h4"),
    "path must contain every intermediate hidden neuron",
  );
});

Deno.test("observation contributions: output with only direct input edges attributes 100% across them", () => {
  const inbound: Record<string, Edge[]> = {
    "output-0": [
      {
        fromUuid: "input-0",
        toUuid: "output-0",
        weight: 1,
        meanContribution: 1,
      },
      {
        fromUuid: "input-1",
        toUuid: "output-0",
        weight: 1,
        meanContribution: 1,
      },
      {
        fromUuid: "input-2",
        toUuid: "output-0",
        weight: 1,
        meanContribution: 1,
      },
    ],
  };

  const res = computeTopContributingInputs({
    focusUuid: "output-0",
    getInboundEdges: inboundLookup(inbound),
    exhaustive: true,
  });

  assert(!res.truncated);
  assertEquals(res.inputs.length, 3);
  const total = res.inputs.reduce((acc, r) => acc + r.score, 0);
  approx(total, 1, 1e-9, "shares must sum to 1");
  for (const r of res.inputs) {
    approx(r.score, 1 / 3, 1e-9, `${r.uuid} should hold one third`);
  }
});

Deno.test("observation contributions: exhaustive mode reaches wide fan-out that default bounds would truncate", () => {
  // Build an output with 60 direct inputs. The default maxInboundPerNode is
  // 40, so without exhaustive mode 20 inputs would silently be dropped.
  const directEdges: Edge[] = [];
  for (let i = 0; i < 60; i++) {
    directEdges.push({
      fromUuid: `input-${i}`,
      toUuid: "output-0",
      weight: 1,
      meanContribution: 1,
    });
  }
  const inbound: Record<string, Edge[]> = { "output-0": directEdges };

  const defaultRes = computeTopContributingInputs({
    focusUuid: "output-0",
    getInboundEdges: inboundLookup(inbound),
  });
  assertEquals(
    defaultRes.inputs.length,
    40,
    "default bounds cap the inbound fan-out at 40",
  );

  const exhaustiveRes = computeTopContributingInputs({
    focusUuid: "output-0",
    getInboundEdges: inboundLookup(inbound),
    exhaustive: true,
  });
  assertEquals(
    exhaustiveRes.inputs.length,
    60,
    "exhaustive mode must reach every direct input",
  );
  const total = exhaustiveRes.inputs.reduce((acc, r) => acc + r.score, 0);
  approx(total, 1, 1e-9, "exhaustive shares must sum to 1");
});

Deno.test("observation contributions: default behaviour is unchanged for non-output callers", () => {
  // Same toy graph as the original attribution_walk test, called without
  // `exhaustive` — focus is a hidden neuron, so defaults must be unchanged.
  const inbound: Record<string, Edge[]> = {
    "hidden-A": [
      {
        fromUuid: "input-0",
        toUuid: "hidden-A",
        weight: 1,
        meanContribution: 1,
      },
      {
        fromUuid: "input-1",
        toUuid: "hidden-A",
        weight: 1,
        meanContribution: 1,
      },
    ],
  };

  const res = computeTopContributingInputs({
    focusUuid: "hidden-A",
    getInboundEdges: inboundLookup(inbound),
  });
  assert(!res.truncated);
  assertEquals(res.inputs.length, 2);
  const total = res.inputs.reduce((acc, r) => acc + r.score, 0);
  approx(total, 1, 1e-9);
});
