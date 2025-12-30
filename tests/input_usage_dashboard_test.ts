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

import {
  buildGraphIndex,
  computeReachableToOutputs,
} from "../docs/shared/graph_analysis.js";

Deno.test("observations reachability: unused inputs are not reachable to outputs", () => {
  const synapses = [
    { fromUuid: "input-0", toUuid: "hidden-A", weight: 1 },
    { fromUuid: "hidden-A", toUuid: "output-0", weight: 1 },
    { fromUuid: "hidden-X", toUuid: "output-0", weight: 1 },
  ];

  const { incomingByTo, outgoingByFrom } = buildGraphIndex(synapses);
  assertEquals(outgoingByFrom.get("input-0")?.length ?? 0, 1);
  assertEquals(outgoingByFrom.get("input-1")?.length ?? 0, 0);

  const reachable = computeReachableToOutputs({
    outputUuids: ["output-0"],
    incomingByTo,
  });

  assert(reachable.has("output-0"), "output-0 should be reachable");
  assert(reachable.has("hidden-A"), "hidden-A should be reachable");
  assert(reachable.has("input-0"), "input-0 should be reachable");
  assert(!reachable.has("input-1"), "input-1 should be unused (unreachable)");
});
