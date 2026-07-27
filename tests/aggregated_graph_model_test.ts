/**
 * Aggregated layered graph model tests (Issue #524).
 *
 * The published snapshot has 2,461 inputs and 21,492 synapses, so every
 * candidate replacement graph view consumes an aggregated, layered model
 * rather than the raw graph. These tests pin that model's contract:
 * `{ nodes, edges, layers, families }`, deterministic output, topological
 * layer assignment, per-node/per-edge impact, and the collapse threshold —
 * including that aggregate nodes keep member identity so a later per-stock
 * view can re-expand or re-weight them.
 */

import { approx, assert, assertEquals } from "./test_helpers.ts";

import {
  assignNeuronLayers,
  buildAggregatedGraphModel,
  DEFAULT_COLLAPSE_THRESHOLD,
} from "../docs/shared/aggregated_graph_model.js";

// deno-lint-ignore no-explicit-any
type Model = any;

/**
 * Four observations across three families feeding three hidden neurons and a
 * single output. `hidden-Z` is deliberately unreachable to any output.
 */
function fixtureSnapshot(): unknown {
  return {
    tooltips: {
      "input-0": { label: "Cash rate", group: "rates" },
      "input-1": { label: "Bond yield", group: "rates" },
      "input-2": { label: "ASX 200 close", group: "equities" },
    },
    creature: {
      input: 4,
      output: 1,
      neurons: [
        { uuid: "hidden-A", type: "hidden", squash: "TANH", bias: 0 },
        { uuid: "hidden-B", type: "hidden", squash: "TANH", bias: 0 },
        { uuid: "hidden-C", type: "hidden", squash: "TANH", bias: 0 },
        { uuid: "hidden-Z", type: "hidden", squash: "TANH", bias: 0 },
        { uuid: "output-0", type: "output", squash: "IDENTITY", bias: 0 },
      ],
      synapses: [
        { fromUuid: "input-0", toUuid: "hidden-A", weight: 1 },
        { fromUuid: "input-1", toUuid: "hidden-A", weight: 0.5 },
        { fromUuid: "input-2", toUuid: "hidden-B", weight: 2 },
        { fromUuid: "input-3", toUuid: "hidden-C", weight: 0.1 },
        { fromUuid: "hidden-A", toUuid: "output-0", weight: 1.5 },
        { fromUuid: "hidden-B", toUuid: "output-0", weight: 1 },
        { fromUuid: "hidden-C", toUuid: "output-0", weight: 0.01 },
      ],
    },
    derived: {
      impactsByNeuronUuid: {
        "output-0": 1,
        "hidden-A": 0.7,
        "hidden-B": 0.29,
        "hidden-C": 0.001,
      },
    },
  };
}

function nodeById(model: Model, id: string): Model {
  return model.nodes.find((n: Model) => n.id === id);
}

function edgeBetween(model: Model, from: string, to: string): Model {
  return model.edges.find((e: Model) => e.from === from && e.to === to);
}

Deno.test("buildAggregatedGraphModel returns nodes, edges, layers and families", () => {
  const model = buildAggregatedGraphModel(fixtureSnapshot()) as Model;

  assert(Array.isArray(model.nodes), "nodes must be an array");
  assert(Array.isArray(model.edges), "edges must be an array");
  assert(Array.isArray(model.layers), "layers must be an array");
  assert(Array.isArray(model.families), "families must be an array");
  assertEquals(model.meta.collapseThreshold, DEFAULT_COLLAPSE_THRESHOLD);
});

Deno.test("inputs collapse into one family node per observation family", () => {
  const model = buildAggregatedGraphModel(fixtureSnapshot()) as Model;

  assertEquals(
    model.families.map((f: Model) => f.key).join(","),
    "equities,rates,ungrouped",
  );

  const rates = nodeById(model, "family:rates");
  assertEquals(rates.kind, "family");
  assertEquals(rates.layer, 0);
  // Member identity is retained so a per-stock view can re-expand the node.
  assertEquals(rates.members.join(","), "input-0,input-1");
  assertEquals(rates.memberCount, 2);

  // Four inputs, three families — nothing at layer 0 but families.
  const layer0 = model.layers[0].nodeIds;
  assertEquals(
    layer0.join(","),
    "family:equities,family:rates,family:ungrouped",
  );
});

Deno.test("layers are topological with outputs on the final layer", () => {
  const model = buildAggregatedGraphModel(fixtureSnapshot()) as Model;

  assertEquals(model.layers.length, 3);
  assertEquals(nodeById(model, "family:rates").layer, 0);
  assertEquals(nodeById(model, "neuron:hidden-A").layer, 1);
  assertEquals(nodeById(model, "neuron:output-0").layer, 2);

  // Every edge steps forward through the layer stack.
  for (const edge of model.edges) {
    const from = nodeById(model, edge.from);
    const to = nodeById(model, edge.to);
    assert(
      from.layer < to.layer,
      `edge ${edge.id} does not advance a layer (${from.layer} -> ${to.layer})`,
    );
  }
});

Deno.test("assignNeuronLayers ranks a chain and pins outputs last", () => {
  const { layerByUuid, layerCount } = assignNeuronLayers({
    synapses: [
      { fromUuid: "input-0", toUuid: "hidden-A" },
      { fromUuid: "hidden-A", toUuid: "hidden-B" },
      { fromUuid: "hidden-B", toUuid: "output-0" },
      // A short-circuit edge must not drag the output back to layer 1.
      { fromUuid: "input-0", toUuid: "output-0" },
    ],
    inputUuids: ["input-0"],
    outputUuids: ["output-0"],
  });

  assertEquals(layerByUuid.get("input-0"), 0);
  assertEquals(layerByUuid.get("hidden-A"), 1);
  assertEquals(layerByUuid.get("hidden-B"), 2);
  assertEquals(layerByUuid.get("output-0"), 3);
  assertEquals(layerCount, 4);
});

Deno.test("assignNeuronLayers terminates on a recurrent graph", () => {
  const { layerByUuid, layerCount } = assignNeuronLayers({
    synapses: [
      { fromUuid: "input-0", toUuid: "hidden-A" },
      { fromUuid: "hidden-A", toUuid: "hidden-B" },
      { fromUuid: "hidden-B", toUuid: "hidden-A" },
      { fromUuid: "hidden-B", toUuid: "output-0" },
    ],
    inputUuids: ["input-0"],
    outputUuids: ["output-0"],
  });

  assertEquals(layerByUuid.get("input-0"), 0);
  assert(layerCount >= 2, "recurrent graph must still produce layers");
  for (const uuid of ["hidden-A", "hidden-B", "output-0"]) {
    assert(
      Number.isInteger(layerByUuid.get(uuid)),
      `${uuid} must receive an integer layer`,
    );
  }
});

Deno.test("neurons that cannot reach an output are dropped", () => {
  const model = buildAggregatedGraphModel(fixtureSnapshot()) as Model;

  assertEquals(nodeById(model, "neuron:hidden-Z"), undefined);
  assertEquals(model.meta.droppedNeuronCount, 1);
  for (const node of model.nodes) {
    assert(
      !node.members.includes("hidden-Z"),
      "hidden-Z must not survive inside an aggregate node",
    );
  }
});

Deno.test("per-node impact aggregates member impacts", () => {
  const model = buildAggregatedGraphModel(fixtureSnapshot()) as Model;

  // Exported impacts are used verbatim for individually-kept neurons.
  approx(nodeById(model, "neuron:hidden-A").impact, 0.7);
  approx(nodeById(model, "neuron:output-0").impact, 1);

  // Inputs carry no exported impact, so the model propagates it back through
  // the inbound allocation: input-0 and input-1 split hidden-A's 0.7 by
  // |weight| (1 and 0.5), and the rates family node sums both members.
  approx(nodeById(model, "family:rates").impact, 0.7, 1e-9);
  approx(nodeById(model, "family:equities").impact, 0.29, 1e-9);
});

Deno.test("per-edge impact allocates the target's impact across inbound edges", () => {
  const model = buildAggregatedGraphModel(fixtureSnapshot()) as Model;

  const inbound = model.edges.filter((e: Model) => e.to === "neuron:output-0");
  const total = inbound.reduce((acc: number, e: Model) => acc + e.impact, 0);
  approx(total, nodeById(model, "neuron:output-0").impact, 1e-9);

  // Shares follow |weight| when no meanContribution is recorded: 1.5 / 2.51.
  approx(
    edgeBetween(model, "neuron:hidden-A", "neuron:output-0").impact,
    1.5 / 2.51,
    1e-9,
  );
});

Deno.test("aggregate edges merge parallel member synapses", () => {
  const model = buildAggregatedGraphModel(fixtureSnapshot()) as Model;

  const edge = edgeBetween(model, "family:rates", "neuron:hidden-A");
  assertEquals(edge.memberCount, 2);
  assertEquals(edge.members.join(","), "input-0→hidden-A,input-1→hidden-A");
  approx(edge.weight, 1.5);
  approx(edge.absWeight, 1.5);
});

Deno.test("the default collapse threshold folds low-impact neurons into a layer node", () => {
  const model = buildAggregatedGraphModel(fixtureSnapshot()) as Model;

  // hidden-C's impact (0.001) is below 1% of the strongest neuron (0.7).
  assertEquals(nodeById(model, "neuron:hidden-C"), undefined);
  const collapsed = nodeById(model, "collapsed:layer-1");
  assertEquals(collapsed.kind, "collapsed");
  assertEquals(collapsed.members.join(","), "hidden-C");
  assertEquals(model.meta.collapsedNeuronCount, 1);
  approx(collapsed.impact, 0.001);
});

Deno.test("a zero collapse threshold keeps every neuron individually", () => {
  const model = buildAggregatedGraphModel(fixtureSnapshot(), {
    collapseThreshold: 0,
  }) as Model;

  assert(nodeById(model, "neuron:hidden-C"), "hidden-C must survive");
  assertEquals(nodeById(model, "collapsed:layer-1"), undefined);
  assertEquals(model.meta.collapsedNeuronCount, 0);
});

Deno.test("a higher collapse threshold folds more neurons into the same aggregate", () => {
  const model = buildAggregatedGraphModel(fixtureSnapshot(), {
    collapseThreshold: 0.5,
  }) as Model;

  assert(nodeById(model, "neuron:hidden-A"), "the strongest neuron is kept");
  assertEquals(nodeById(model, "neuron:hidden-B"), undefined);
  const collapsed = nodeById(model, "collapsed:layer-1");
  assertEquals(collapsed.members.join(","), "hidden-B,hidden-C");
  assertEquals(model.meta.collapsedNeuronCount, 2);
  // Output neurons are never collapsed, however weak.
  assert(nodeById(model, "neuron:output-0"), "outputs are always kept");
});

Deno.test("aggregate node identity is stable across collapse thresholds", () => {
  const loose = buildAggregatedGraphModel(fixtureSnapshot(), {
    collapseThreshold: 0,
  }) as Model;
  const tight = buildAggregatedGraphModel(fixtureSnapshot(), {
    collapseThreshold: 0.5,
  }) as Model;

  // Family and kept-neuron ids do not change when the threshold moves, so a
  // view can re-render without losing the user's selection.
  assertEquals(nodeById(loose, "family:rates").id, "family:rates");
  assertEquals(nodeById(tight, "family:rates").id, "family:rates");
  assertEquals(nodeById(loose, "neuron:hidden-A").id, "neuron:hidden-A");
  assertEquals(nodeById(tight, "neuron:hidden-A").id, "neuron:hidden-A");
});

Deno.test("the model is deterministic for identical input", () => {
  const first = buildAggregatedGraphModel(fixtureSnapshot()) as Model;
  const second = buildAggregatedGraphModel(fixtureSnapshot()) as Model;
  assertEquals(JSON.stringify(first), JSON.stringify(second));
});

Deno.test("per-node output attribution is attached from the aggregated graph", () => {
  const model = buildAggregatedGraphModel(fixtureSnapshot()) as Model;

  const rates = nodeById(model, "family:rates");
  assertEquals(rates.outputShares.length, 1);
  assertEquals(rates.outputShares[0].nodeId, "neuron:output-0");
  approx(rates.outputShares[0].share, 1);
  assertEquals(model.meta.outputSharesComputed, true);

  // An output node has no downstream path of its own.
  assertEquals(nodeById(model, "neuron:output-0").outputShares.length, 0);
});

Deno.test("output attribution is skipped, and flagged, above the node budget", () => {
  const model = buildAggregatedGraphModel(fixtureSnapshot(), {
    maxAttributionNodes: 2,
  }) as Model;

  assertEquals(model.meta.outputSharesComputed, false);
  for (const node of model.nodes) {
    assertEquals(node.outputShares.length, 0);
  }
});

Deno.test("a recurrent snapshot still produces a finite model", () => {
  const snapshot = fixtureSnapshot() as Model;
  snapshot.creature.synapses.push({
    fromUuid: "hidden-B",
    toUuid: "hidden-A",
    weight: 0.25,
  });
  const model = buildAggregatedGraphModel(snapshot) as Model;

  assert(model.nodes.length > 0, "recurrent graph must still yield nodes");
  for (const node of model.nodes) {
    assert(
      Number.isFinite(node.impact),
      `${node.id} must carry a finite impact`,
    );
    assert(Number.isInteger(node.layer), `${node.id} must carry a layer`);
  }
});

Deno.test("buildAggregatedGraphModel fails loudly without a creature", () => {
  let threw = false;
  try {
    buildAggregatedGraphModel({});
  } catch {
    threw = true;
  }
  assert(
    threw,
    "a snapshot with no creature must throw, not return an empty model",
  );
});
