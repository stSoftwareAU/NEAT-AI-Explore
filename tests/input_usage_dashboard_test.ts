import { assert, assertEquals } from "./test_helpers.ts";

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

Deno.test("disconnected inputs (out-degree=0) are always unused (unreachable to outputs)", () => {
  // Issue #55: "disconnected" and "unused" are redundant for input neurons.
  // An input with out-degree=0 has no outgoing synapses, so it cannot reach
  // any output. Therefore, every disconnected input is also unused.
  // This test proves disconnected ⊆ unused, justifying removal of the
  // "disconnected" checkbox.

  const synapses = [
    // input-0 is connected (out-degree=1) and reaches output
    { fromUuid: "input-0", toUuid: "hidden-A", weight: 1 },
    { fromUuid: "hidden-A", toUuid: "output-0", weight: 1 },

    // input-1 is connected (out-degree=1) but reaches a dead-end hidden node
    // This makes it unused but NOT disconnected
    { fromUuid: "input-1", toUuid: "hidden-dead", weight: 1 },
    // hidden-dead has no path to output-0

    // input-2 has no outgoing synapses (disconnected, out-degree=0)
    // It is also unused because it cannot reach any output
  ];

  const { incomingByTo, outgoingByFrom } = buildGraphIndex(synapses);

  // Check out-degrees
  assertEquals(
    outgoingByFrom.get("input-0")?.length ?? 0,
    1,
    "input-0 should have out-degree 1",
  );
  assertEquals(
    outgoingByFrom.get("input-1")?.length ?? 0,
    1,
    "input-1 should have out-degree 1",
  );
  assertEquals(
    outgoingByFrom.get("input-2")?.length ?? 0,
    0,
    "input-2 should have out-degree 0 (disconnected)",
  );

  const reachable = computeReachableToOutputs({
    outputUuids: ["output-0"],
    incomingByTo,
  });

  // input-0: connected and reachable (used)
  assert(reachable.has("input-0"), "input-0 should be reachable (used)");

  // input-1: connected but unreachable (unused but NOT disconnected)
  assert(!reachable.has("input-1"), "input-1 should be unreachable (unused)");

  // input-2: disconnected (out-degree=0) and therefore also unreachable (unused)
  // This is the key assertion: disconnected => unused
  assert(
    !reachable.has("input-2"),
    "input-2 should be unreachable (unused) because it is disconnected",
  );

  // The key insight: for input neurons, disconnected (out-degree=0) implies unused.
  // An input is a source node in the directed graph.
  // If it has no outgoing edges, there is no path from it to any other node,
  // including outputs. Therefore, disconnected ⊆ unused for inputs.
  //
  // However, unused ⊄ disconnected: input-1 shows an input can be unused
  // (unreachable to outputs) while still having outgoing synapses.
});
