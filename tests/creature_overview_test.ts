/**
 * Tests for creature overview dashboard metric computations.
 *
 * These are "what" tests: import the module, call functions with test data,
 * assert results.
 */

import {
  computeActivationDistribution,
  computeLayerTopology,
  computeNetworkDepth,
  computeNeuronBreakdown,
  computeSynapseStats,
} from "../docs/shared/creature_overview.js";
import { approx, assert, assertEquals } from "./test_helpers.ts";

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

function makeNeuron(
  uuid: string,
  type: string,
  squash = "SIGMOID",
  bias = 0,
) {
  return { uuid, type, squash, bias };
}

function makeSynapse(fromUuid: string, toUuid: string, weight = 1.0) {
  return { fromUuid, toUuid, weight };
}

// ---------------------------------------------------------------------------
// computeNeuronBreakdown
// ---------------------------------------------------------------------------

Deno.test("computeNeuronBreakdown counts neuron types correctly", () => {
  const neurons = [
    makeNeuron("input-0", "input"),
    makeNeuron("input-1", "input"),
    makeNeuron("hidden-a", "hidden", "TANH"),
    makeNeuron("hidden-b", "hidden", "RELU"),
    makeNeuron("hidden-c", "hidden", "SIGMOID"),
    makeNeuron("output-0", "output"),
  ];
  const result = computeNeuronBreakdown(neurons);
  assertEquals(result.total, 6);
  assertEquals(result.input, 2);
  assertEquals(result.hidden, 3);
  assertEquals(result.output, 1);
  assertEquals(result.constant, 0);
});

Deno.test("computeNeuronBreakdown handles empty array", () => {
  const result = computeNeuronBreakdown([]);
  assertEquals(result.total, 0);
  assertEquals(result.input, 0);
  assertEquals(result.hidden, 0);
  assertEquals(result.output, 0);
  assertEquals(result.constant, 0);
});

Deno.test("computeNeuronBreakdown handles constant neurons", () => {
  const neurons = [
    makeNeuron("const-0", "constant"),
    makeNeuron("input-0", "input"),
    makeNeuron("output-0", "output"),
  ];
  const result = computeNeuronBreakdown(neurons);
  assertEquals(result.constant, 1);
  assertEquals(result.total, 3);
});

// ---------------------------------------------------------------------------
// computeSynapseStats
// ---------------------------------------------------------------------------

Deno.test("computeSynapseStats computes total and average connectivity", () => {
  const synapses = [
    makeSynapse("input-0", "hidden-a"),
    makeSynapse("input-1", "hidden-a"),
    makeSynapse("hidden-a", "output-0"),
  ];
  const result = computeSynapseStats(synapses, 4);
  assertEquals(result.total, 3);
  approx(result.avgPerNeuron, 0.75, 0.01);
});

Deno.test("computeSynapseStats handles empty synapses", () => {
  const result = computeSynapseStats([], 0);
  assertEquals(result.total, 0);
  assertEquals(result.avgPerNeuron, 0);
});

Deno.test("computeSynapseStats handles zero neurons gracefully", () => {
  const result = computeSynapseStats([makeSynapse("a", "b")], 0);
  assertEquals(result.total, 1);
  assertEquals(result.avgPerNeuron, 0);
});

// ---------------------------------------------------------------------------
// computeNetworkDepth
// ---------------------------------------------------------------------------

Deno.test("computeNetworkDepth finds longest path in simple chain", () => {
  // input-0 -> hidden-a -> output-0  (depth = 2 edges)
  const synapses = [
    makeSynapse("input-0", "hidden-a"),
    makeSynapse("hidden-a", "output-0"),
  ];
  const depth = computeNetworkDepth(
    synapses,
    ["input-0"],
    ["output-0"],
  );
  assertEquals(depth, 2);
});

Deno.test("computeNetworkDepth finds longest across parallel paths", () => {
  // Short path: input-0 -> output-0 (depth 1)
  // Long path:  input-0 -> hidden-a -> hidden-b -> output-0 (depth 3)
  const synapses = [
    makeSynapse("input-0", "output-0"),
    makeSynapse("input-0", "hidden-a"),
    makeSynapse("hidden-a", "hidden-b"),
    makeSynapse("hidden-b", "output-0"),
  ];
  const depth = computeNetworkDepth(
    synapses,
    ["input-0"],
    ["output-0"],
  );
  assertEquals(depth, 3);
});

Deno.test("computeNetworkDepth returns 0 for empty network", () => {
  assertEquals(computeNetworkDepth([], [], []), 0);
});

Deno.test("computeNetworkDepth returns 0 when no path exists", () => {
  const synapses = [makeSynapse("a", "b")];
  assertEquals(computeNetworkDepth(synapses, ["x"], ["y"]), 0);
});

Deno.test("computeNetworkDepth handles direct input-to-output", () => {
  const synapses = [makeSynapse("input-0", "output-0")];
  assertEquals(
    computeNetworkDepth(synapses, ["input-0"], ["output-0"]),
    1,
  );
});

// ---------------------------------------------------------------------------
// computeActivationDistribution
// ---------------------------------------------------------------------------

Deno.test("computeActivationDistribution counts squash functions", () => {
  const neurons = [
    makeNeuron("h1", "hidden", "SIGMOID"),
    makeNeuron("h2", "hidden", "SIGMOID"),
    makeNeuron("h3", "hidden", "TANH"),
    makeNeuron("o0", "output", "SIGMOID"),
  ];
  const dist = computeActivationDistribution(neurons);
  assertEquals(dist.get("SIGMOID"), 3);
  assertEquals(dist.get("TANH"), 1);
});

Deno.test("computeActivationDistribution excludes input neurons", () => {
  const neurons = [
    makeNeuron("input-0", "input", "IDENTITY"),
    makeNeuron("h1", "hidden", "RELU"),
    makeNeuron("o0", "output", "RELU"),
  ];
  const dist = computeActivationDistribution(neurons);
  assert(!dist.has("IDENTITY"));
  assertEquals(dist.get("RELU"), 2);
});

Deno.test("computeActivationDistribution returns empty map for no neurons", () => {
  const dist = computeActivationDistribution([]);
  assertEquals(dist.size, 0);
});

// ---------------------------------------------------------------------------
// computeLayerTopology
// ---------------------------------------------------------------------------

Deno.test("computeLayerTopology produces correct layer structure", () => {
  const neurons = [
    makeNeuron("input-0", "input"),
    makeNeuron("input-1", "input"),
    makeNeuron("hidden-a", "hidden", "TANH"),
    makeNeuron("output-0", "output"),
  ];
  const synapses = [
    makeSynapse("input-0", "hidden-a"),
    makeSynapse("input-1", "hidden-a"),
    makeSynapse("hidden-a", "output-0"),
  ];
  const topo = computeLayerTopology(neurons, synapses);

  // Should have at least input, hidden, and output layers
  assert(topo.layers.length >= 3);

  // First layer should be inputs
  assertEquals(topo.layers[0].type, "input");
  assertEquals(topo.layers[0].count, 2);

  // Last layer should be outputs
  const last = topo.layers[topo.layers.length - 1];
  assertEquals(last.type, "output");
  assertEquals(last.count, 1);
});

Deno.test("computeLayerTopology handles direct input-to-output", () => {
  const neurons = [
    makeNeuron("input-0", "input"),
    makeNeuron("output-0", "output"),
  ];
  const synapses = [makeSynapse("input-0", "output-0")];
  const topo = computeLayerTopology(neurons, synapses);

  assertEquals(topo.layers.length, 2);
  assertEquals(topo.layers[0].type, "input");
  assertEquals(topo.layers[1].type, "output");
});

Deno.test("computeLayerTopology handles multiple hidden depths", () => {
  // input-0 -> hidden-a -> hidden-b -> output-0
  const neurons = [
    makeNeuron("input-0", "input"),
    makeNeuron("hidden-a", "hidden"),
    makeNeuron("hidden-b", "hidden"),
    makeNeuron("output-0", "output"),
  ];
  const synapses = [
    makeSynapse("input-0", "hidden-a"),
    makeSynapse("hidden-a", "hidden-b"),
    makeSynapse("hidden-b", "output-0"),
  ];
  const topo = computeLayerTopology(neurons, synapses);

  // Should have input, hidden-depth-1, hidden-depth-2, output = 4 layers
  assertEquals(topo.layers.length, 4);
  assertEquals(topo.layers[0].type, "input");
  assertEquals(topo.layers[1].type, "hidden");
  assertEquals(topo.layers[1].count, 1);
  assertEquals(topo.layers[2].type, "hidden");
  assertEquals(topo.layers[2].count, 1);
  assertEquals(topo.layers[3].type, "output");
});

Deno.test("computeLayerTopology handles empty network", () => {
  const topo = computeLayerTopology([], []);
  assertEquals(topo.layers.length, 0);
});

// ---------------------------------------------------------------------------
// computeLayerTopology — inter-layer edges (issue #119)
// ---------------------------------------------------------------------------

Deno.test("computeLayerTopology returns edges between adjacent layers", () => {
  // input-0 → hidden-a → output-0
  const neurons = [
    makeNeuron("input-0", "input"),
    makeNeuron("hidden-a", "hidden"),
    makeNeuron("output-0", "output"),
  ];
  const synapses = [
    makeSynapse("input-0", "hidden-a"),
    makeSynapse("hidden-a", "output-0"),
  ];
  const topo = computeLayerTopology(neurons, synapses);

  assert(Array.isArray(topo.edges), "edges should be an array");
  // Two edges: layer 0→1, layer 1→2
  assertEquals(topo.edges.length, 2);
  assertEquals(topo.edges[0].from, 0);
  assertEquals(topo.edges[0].to, 1);
  assertEquals(topo.edges[1].from, 1);
  assertEquals(topo.edges[1].to, 2);
});

Deno.test("computeLayerTopology returns skip-connection edges", () => {
  // input-0 → hidden-a → output-0
  // input-0 → output-0  (skip connection!)
  const neurons = [
    makeNeuron("input-0", "input"),
    makeNeuron("hidden-a", "hidden"),
    makeNeuron("output-0", "output"),
  ];
  const synapses = [
    makeSynapse("input-0", "hidden-a"),
    makeSynapse("hidden-a", "output-0"),
    makeSynapse("input-0", "output-0"), // skip connection
  ];
  const topo = computeLayerTopology(neurons, synapses);

  assert(Array.isArray(topo.edges), "edges should be an array");
  // Three edges: 0→1, 1→2, and 0→2 (skip)
  assertEquals(topo.edges.length, 3);

  // Find the skip edge (from layer 0 to layer 2)
  const skip = topo.edges.find((e: { from: number; to: number }) =>
    e.from === 0 && e.to === 2
  );
  assert(skip, "should have a skip-connection edge from input to output layer");
});

Deno.test("computeLayerTopology edges include synapse count", () => {
  // Two synapses from input layer to hidden layer
  const neurons = [
    makeNeuron("input-0", "input"),
    makeNeuron("input-1", "input"),
    makeNeuron("hidden-a", "hidden"),
    makeNeuron("output-0", "output"),
  ];
  const synapses = [
    makeSynapse("input-0", "hidden-a"),
    makeSynapse("input-1", "hidden-a"),
    makeSynapse("hidden-a", "output-0"),
  ];
  const topo = computeLayerTopology(neurons, synapses);

  const inputToHidden = topo.edges.find((e: { from: number; to: number }) =>
    e.from === 0 && e.to === 1
  );
  assert(inputToHidden, "should have input→hidden edge");
  assertEquals(inputToHidden.count, 2);

  const hiddenToOutput = topo.edges.find((e: { from: number; to: number }) =>
    e.from === 1 && e.to === 2
  );
  assert(hiddenToOutput, "should have hidden→output edge");
  assertEquals(hiddenToOutput.count, 1);
});

Deno.test("computeLayerTopology edges empty for no synapses", () => {
  const topo = computeLayerTopology([], []);
  assert(
    !topo.edges || topo.edges.length === 0,
    "no edges for empty network",
  );
});
