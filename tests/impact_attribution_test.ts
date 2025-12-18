function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function assertEquals<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new Error(
      message ??
        `Assertion failed: expected ${JSON.stringify(expected)} but got ${
          JSON.stringify(actual)
        }`,
    );
  }
}

type Synapse = { fromUuid: string; toUuid: string; weight: number };

import { computeImpactBreakdownToOutputs } from "../impact_attribution.js";

Deno.test("computeImpactBreakdownToOutputs splits impact across outputs and paths", () => {
  // Graph:
  // A -> output-0 (w 1)
  // A -> B (w 1) -> output-0 (w 1)
  // A -> output-1 (w 2)
  //
  // Path scores (product(|w|)):
  // - output-0: 1 (direct) + 1 (via B) = 2
  // - output-1: 2
  // Shares: 0.5 / 0.5
  const synapses: Synapse[] = [
    { fromUuid: "hidden-A", toUuid: "output-0", weight: 1 },
    { fromUuid: "hidden-A", toUuid: "hidden-B", weight: 1 },
    { fromUuid: "hidden-B", toUuid: "output-0", weight: 1 },
    { fromUuid: "hidden-A", toUuid: "output-1", weight: 2 },
  ];

  const res = computeImpactBreakdownToOutputs({
    startUuid: "hidden-A",
    synapses,
    outputUuids: ["output-0", "output-1"],
    neuronImpact: 0.2,
    maxDepth: 10,
    maxPaths: 100,
    topPathsPerOutput: 10,
  });

  assertEquals(res.outputs.length, 2);

  const byOut = new Map(res.outputs.map((o) => [o.outputUuid, o]));
  const out0 = byOut.get("output-0");
  const out1 = byOut.get("output-1");
  assert(out0, "Expected output-0 breakdown");
  assert(out1, "Expected output-1 breakdown");

  assertEquals(out0.pathCount, 2);
  assertEquals(out1.pathCount, 1);

  // Shares may have tiny floating error; check within tolerance.
  const tol = 1e-12;
  assert(
    Math.abs(out0.share - 0.5) < tol,
    `Expected output-0 share ~0.5, got ${out0.share}`,
  );
  assert(
    Math.abs(out1.share - 0.5) < tol,
    `Expected output-1 share ~0.5, got ${out1.share}`,
  );

  assert(Math.abs((out0.allocatedImpact ?? 0) - 0.1) < tol);
  assert(Math.abs((out1.allocatedImpact ?? 0) - 0.1) < tol);

  // Ensure both distinct output-0 paths are present.
  const out0Paths = new Set(out0.topPaths.map((p) => p.nodes.join("→")));
  assert(out0Paths.has("hidden-A→output-0"));
  assert(out0Paths.has("hidden-A→hidden-B→output-0"));
});

Deno.test("computeImpactBreakdownToOutputs avoids cycles", () => {
  // Cycle: A -> B -> A, plus B -> output-0.
  const synapses: Synapse[] = [
    { fromUuid: "hidden-A", toUuid: "hidden-B", weight: 1 },
    { fromUuid: "hidden-B", toUuid: "hidden-A", weight: 1 },
    { fromUuid: "hidden-B", toUuid: "output-0", weight: 1 },
  ];

  const res = computeImpactBreakdownToOutputs({
    startUuid: "hidden-A",
    synapses,
    outputUuids: ["output-0"],
    neuronImpact: 1,
    maxDepth: 10,
    maxPaths: 100,
    topPathsPerOutput: 3,
  });

  assertEquals(res.outputs.length, 1);
  assertEquals(res.outputs[0].outputUuid, "output-0");
  assertEquals(res.outputs[0].pathCount, 1);
  assertEquals(res.truncated, false);
});
