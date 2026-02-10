import { approx, assert } from "./test_helpers.ts";

import { computeTopContributingInputs } from "../docs/shared/graph_analysis.js";

Deno.test("attribution walk: top contributing inputs are derived from inbound shares", () => {
  type Edge = {
    fromUuid: string;
    toUuid: string;
    weight: number;
    meanContribution: number;
  };

  const inbound: Record<string, Edge[]> = {
    "output-0": [
      {
        fromUuid: "hidden-A",
        toUuid: "output-0",
        weight: 1,
        meanContribution: 2,
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
    "hidden-B": [
      {
        fromUuid: "input-2",
        toUuid: "hidden-B",
        weight: 1,
        meanContribution: 1,
      },
    ],
  };

  const res = computeTopContributingInputs({
    focusUuid: "output-0",
    getInboundEdges: (toUuid) => inbound[toUuid] ?? [],
    maxDepth: 6,
    maxWork: 200,
    maxInboundPerNode: 10,
  });

  assert(
    !res.truncated,
    "Expected attribution walk not to truncate on toy graph",
  );

  const byUuid = new Map(res.inputs.map((r) => [r.uuid, r]));
  const a = byUuid.get("input-0");
  const b = byUuid.get("input-1");
  const c = byUuid.get("input-2");
  assert(a && b && c, "Expected all three inputs to appear");

  // Shares:
  // output-0 inbound: A 2/3, B 1/3
  // A inbound: input-0 1/2, input-1 1/2
  // B inbound: input-2 1
  // => each input should be ~1/3 after normalisation.
  const tol = 1e-9;
  approx(a.score, 1 / 3, tol, "input-0 share");
  approx(b.score, 1 / 3, tol, "input-1 share");
  approx(c.score, 1 / 3, tol, "input-2 share");

  assert(
    Array.isArray(c.path) && c.path[c.path.length - 1] === "output-0",
    "Expected stored path to end at the focus neuron",
  );
});
