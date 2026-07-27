/**
 * Sankey contribution-flow view tests (Issue #526).
 *
 * The Sankey view is a contrasting candidate to the layered DAG: it renders
 * contribution *flow* from observation families → hidden layers → output, with
 * band width proportional to contribution to the Score. These tests pin the
 * DOM-free core (`sankey_flow.js`) that the browser view renders:
 *
 *   1. the flow data builds from the aggregated model without throwing;
 *   2. every band's width is proportional to its contribution, and the
 *      family→output flow sums back to the Score total (conserved Sankey);
 *   3. low-impact flows are collapsed below the aggregation threshold, so the
 *      node/link count stays within the readability budget despite a snapshot
 *      scaled toward the published 2,461 inputs / 21,492 synapses.
 *
 * A regression in the model's edge weights or the aggregation logic fails these
 * before merge — the failure-detection contract from the issue.
 */

import { approx, assert, assertEquals } from "./test_helpers.ts";

import { buildAggregatedGraphModel } from "../docs/shared/aggregated_graph_model.js";
import {
  bandWidth,
  buildSankeyFlow,
  DEFAULT_MAX_NODES_PER_LAYER,
  DEFAULT_MAX_SANKEY_LINKS,
  DEFAULT_MAX_SANKEY_NODES,
  traceLinkFlow,
  traceNodeFlow,
} from "../docs/shared/sankey_flow.js";

// deno-lint-ignore no-explicit-any
type Any = any;

/**
 * Small, hand-checkable snapshot: two rate observations and one equity feeding
 * two strong hidden neurons plus one deliberately weak hidden neuron, all into
 * a single output. Mirrors the aggregated-model fixture so the numbers line up.
 */
function smallSnapshot(): unknown {
  return {
    tooltips: {
      "input-0": {
        label: "Cash rate",
        description: "RBA overnight cash rate",
        group: "rates",
      },
      "input-1": {
        label: "Bond yield",
        description: "10-year AGB yield",
        group: "rates",
      },
      "input-2": {
        label: "ASX 200 close",
        description: "Daily ASX 200 close",
        group: "equities",
      },
    },
    creature: {
      input: 4,
      output: 1,
      neurons: [
        { uuid: "hidden-A", type: "hidden", squash: "TANH", bias: 0 },
        { uuid: "hidden-B", type: "hidden", squash: "TANH", bias: 0 },
        { uuid: "hidden-C", type: "hidden", squash: "TANH", bias: 0 },
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

/**
 * A snapshot scaled toward the published network's shape: four observation
 * families, two strong hidden pathways, and a large fan of weak hidden neurons
 * that must collapse. Exercises the readability budget and the collapse logic.
 */
function scaledSnapshot(weakCount = 200): unknown {
  const tooltips: Record<string, unknown> = {};
  const neurons: Array<Record<string, unknown>> = [];
  const synapses: Array<Record<string, unknown>> = [];
  const impacts: Record<string, number> = { "output-0": 1 };

  const families = ["rates", "equities", "macro", "fx"];
  const inputCount = 8;
  for (let i = 0; i < inputCount; i++) {
    tooltips[`input-${i}`] = {
      label: `Observation ${i}`,
      description: `Synthetic observation ${i}`,
      group: families[i % families.length],
    };
  }

  // Two strong hidden pathways carry most of the Score.
  neurons.push({ uuid: "hidden-strong-A", type: "hidden", squash: "TANH" });
  neurons.push({ uuid: "hidden-strong-B", type: "hidden", squash: "TANH" });
  impacts["hidden-strong-A"] = 0.6;
  impacts["hidden-strong-B"] = 0.35;
  synapses.push({
    fromUuid: "input-0",
    toUuid: "hidden-strong-A",
    weight: 1.2,
  });
  synapses.push({
    fromUuid: "input-1",
    toUuid: "hidden-strong-A",
    weight: 0.8,
  });
  synapses.push({
    fromUuid: "input-2",
    toUuid: "hidden-strong-B",
    weight: 1.5,
  });
  synapses.push({
    fromUuid: "input-3",
    toUuid: "hidden-strong-B",
    weight: 0.5,
  });
  synapses.push({
    fromUuid: "hidden-strong-A",
    toUuid: "output-0",
    weight: 1.6,
  });
  synapses.push({
    fromUuid: "hidden-strong-B",
    toUuid: "output-0",
    weight: 1.1,
  });

  // A large fan of weak hidden neurons — each below 1% of the strongest, so the
  // model folds them into a per-layer collapsed node.
  for (let i = 0; i < weakCount; i++) {
    const uuid = `hidden-weak-${i}`;
    neurons.push({ uuid, type: "hidden", squash: "TANH" });
    impacts[uuid] = 1e-4;
    const src = `input-${4 + (i % 4)}`;
    synapses.push({ fromUuid: src, toUuid: uuid, weight: 0.05 });
    synapses.push({ fromUuid: uuid, toUuid: "output-0", weight: 0.01 });
  }

  neurons.push({ uuid: "output-0", type: "output", squash: "IDENTITY" });

  return {
    tooltips,
    creature: { input: inputCount, output: 1, neurons, synapses },
    derived: { impactsByNeuronUuid: impacts },
  };
}

/**
 * A snapshot whose observations carry no shared group — every input becomes its
 * own single-observation family, mirroring the published snapshot's 2,132
 * families. Exercises the Sankey's per-layer rank folding at layer 0.
 */
function manyFamiliesSnapshot(inputCount = 60): unknown {
  const tooltips: Record<string, unknown> = {};
  const neurons: Array<Record<string, unknown>> = [
    { uuid: "hidden-A", type: "hidden", squash: "TANH" },
    { uuid: "output-0", type: "output", squash: "IDENTITY" },
  ];
  const synapses: Array<Record<string, unknown>> = [
    { fromUuid: "hidden-A", toUuid: "output-0", weight: 1 },
  ];
  const impacts: Record<string, number> = { "output-0": 1, "hidden-A": 1 };

  for (let i = 0; i < inputCount; i++) {
    // Distinct group per input → a distinct family per observation.
    tooltips[`input-${i}`] = {
      label: `Signal ${i}`,
      description: `Independent signal ${i}`,
      group: `fam-${i}`,
    };
    // Descending weights give the families a clear contribution ranking.
    synapses.push({
      fromUuid: `input-${i}`,
      toUuid: "hidden-A",
      weight: 1 / (i + 1),
    });
  }

  return {
    tooltips,
    creature: { input: inputCount, output: 1, neurons, synapses },
    derived: { impactsByNeuronUuid: impacts },
  };
}

function flowFrom(snapshot: unknown, options: Any = {}): Any {
  const model = buildAggregatedGraphModel(snapshot);
  return buildSankeyFlow(model, options);
}

function nodeById(flow: Any, id: string): Any {
  return flow.nodes.find((n: Any) => n.id === id);
}

Deno.test("buildSankeyFlow builds flow data from the aggregated model without throwing", () => {
  const flow = flowFrom(smallSnapshot());
  assert(Array.isArray(flow.nodes), "nodes must be an array");
  assert(Array.isArray(flow.links), "links must be an array");
  assert(Array.isArray(flow.columns), "columns must be an array");
  assert(flow.nodes.length > 0, "flow must have nodes");
  assert(flow.links.length > 0, "flow must have links");
});

Deno.test("the Score total is the summed output impact", () => {
  const flow = flowFrom(smallSnapshot());
  approx(flow.totalScore, 1);
  approx(flow.meta.totalScore, 1);
});

Deno.test("family→output flow sums back to the Score total (conserved Sankey)", () => {
  const flow = flowFrom(smallSnapshot());

  // Flow entering the output column equals the Score.
  approx(flow.meta.inboundToOutputs, flow.totalScore, 1e-9);

  // The layer-0 observation families are where flow originates; their bands sum
  // back to the Score, so the Sankey decomposes the Score across families.
  approx(flow.meta.sourceFlowTotal, flow.totalScore, 1e-9);

  const familyTotal = flow.nodes
    .filter((n: Any) => n.kind === "family")
    .reduce((acc: number, n: Any) => acc + n.value, 0);
  approx(familyTotal, flow.totalScore, 1e-9);
});

Deno.test("flow is conserved at every node (inbound bands = throughput = outbound bands)", () => {
  const flow = flowFrom(smallSnapshot());
  const inbound = new Map<string, number>();
  const outbound = new Map<string, number>();
  for (const link of flow.links) {
    inbound.set(link.target, (inbound.get(link.target) ?? 0) + link.value);
    outbound.set(link.source, (outbound.get(link.source) ?? 0) + link.value);
  }
  for (const node of flow.nodes) {
    if (!node.isOutput && outbound.has(node.id)) {
      approx(
        outbound.get(node.id)!,
        node.value,
        1e-9,
        `${node.id} outbound bands must equal its throughput`,
      );
    }
    if (node.kind !== "family" && inbound.has(node.id)) {
      approx(
        inbound.get(node.id)!,
        node.value,
        1e-9,
        `${node.id} inbound bands must equal its throughput`,
      );
    }
  }
});

Deno.test("band width is proportional to contribution to the Score", () => {
  const flow = flowFrom(smallSnapshot());

  // hidden-A carries a bigger share of the output than hidden-B (weights 1.5 vs
  // 1.0), so its band into the output must be wider.
  const toOutput = flow.links.filter((l: Any) =>
    l.target === "neuron:output-0"
  );
  const a = toOutput.find((l: Any) => l.source === "neuron:hidden-A");
  const b = toOutput.find((l: Any) => l.source === "neuron:hidden-B");
  assert(a && b, "both strong pathways must reach the output");
  assert(a.value > b.value, "the stronger contributor must carry more flow");

  // bandWidth is strictly linear in value, so the pixel ratio matches the flow
  // ratio — the visual encoding is proportional, not merely ordered.
  const pxPerUnit = 200;
  approx(
    bandWidth(a.value, pxPerUnit) / bandWidth(b.value, pxPerUnit),
    a.value / b.value,
    1e-9,
  );
  approx(bandWidth(2 * a.value, pxPerUnit), 2 * bandWidth(a.value, pxPerUnit));
});

Deno.test("bandWidth floors a positive band and zeroes a non-positive one", () => {
  assertEquals(bandWidth(0, 100), 0);
  assertEquals(bandWidth(-1, 100), 0);
  assertEquals(bandWidth(5, 0), 0);
  // Tiny positive flow still renders a visible, tappable band.
  assertEquals(bandWidth(1e-9, 1, 2), 2);
});

Deno.test("hidden-A's band into the output matches the model's allocation share", () => {
  const flow = flowFrom(smallSnapshot());
  const a = flow.links.find((l: Any) =>
    l.source === "neuron:hidden-A" && l.target === "neuron:output-0"
  );
  // Shares follow |weight| with no meanContribution: 1.5 / (1.5 + 1 + 0.01).
  approx(a.value, 1.5 / 2.51, 1e-9);
});

Deno.test("low-impact flows collapse and the diagram stays within the readability budget", () => {
  const flow = flowFrom(scaledSnapshot(200));

  // The weak fan folded into a single collapsed node instead of 200 bands.
  const collapsed = flow.nodes.filter((n: Any) => n.kind === "collapsed");
  assert(collapsed.length >= 1, "weak neurons must collapse into a layer node");

  // Node and link counts stay legible despite the scaled network.
  assert(
    flow.meta.withinBudget,
    `flow must stay within the readability budget (${flow.meta.nodeCount} nodes, ${flow.meta.linkCount} links)`,
  );
  assert(flow.nodes.length <= DEFAULT_MAX_SANKEY_NODES);
  assert(flow.links.length <= DEFAULT_MAX_SANKEY_LINKS);

  // The raw network was far larger than what is rendered — aggregation worked.
  assert(
    flow.meta.rawNeuronCount > flow.nodes.length * 2,
    "raw neuron count must dwarf the rendered node count",
  );
  assert(
    flow.meta.rawSynapseCount > flow.links.length * 2,
    "raw synapse count must dwarf the rendered link count",
  );
});

Deno.test("the Score is still conserved after aggressive collapse", () => {
  const flow = flowFrom(scaledSnapshot(200));
  approx(flow.meta.inboundToOutputs, flow.totalScore, 1e-6);
  approx(flow.meta.sourceFlowTotal, flow.totalScore, 1e-6);
});

Deno.test("family nodes surface the #521 observation-summary tooltip", () => {
  const flow = flowFrom(smallSnapshot(), {
    labels: {
      "input-0": "Cash rate",
      "input-1": "Bond yield",
      "input-2": "ASX 200 close",
    },
    descriptions: {
      "input-0": "RBA overnight cash rate",
      "input-1": "10-year AGB yield",
    },
  });

  const rates = nodeById(flow, "family:rates");
  assert(rates, "rates family node must exist");
  // Uses buildObservationTooltip's "label — description" format from #521.
  assert(
    rates.tooltip.includes("Cash rate — RBA overnight cash rate"),
    "family tooltip must carry the observation summary",
  );
  assert(
    rates.tooltip.includes("2 observations"),
    "family tooltip must report its member count",
  );
});

Deno.test("collapsed nodes describe themselves as folded, not blank", () => {
  const flow = flowFrom(scaledSnapshot(50));
  const collapsed = flow.nodes.find((n: Any) => n.kind === "collapsed");
  assert(collapsed, "a collapsed node must exist");
  assert(
    /low-impact/.test(collapsed.label),
    "collapsed label must summarise the folded neurons",
  );
  assert(
    /folded/.test(collapsed.tooltip),
    "collapsed tooltip must explain the fold",
  );
});

Deno.test("thousands of single-observation families fold into a readable diagram", () => {
  const flow = flowFrom(manyFamiliesSnapshot(60));

  // Layer 0 held 60 families; rank folding keeps the budget plus one "other".
  const layer0 = flow.nodes.filter((n: Any) => n.layer === 0);
  assert(
    layer0.length <= DEFAULT_MAX_NODES_PER_LAYER + 1,
    `layer 0 must fold to the per-layer budget, got ${layer0.length}`,
  );

  const other = flow.nodes.find((n: Any) => n.kind === "other");
  assert(other, "the folded tail must appear as an 'other' node");
  assert(
    /minor observation families/.test(other.label),
    "the other node must name the folded families",
  );
  assert(flow.meta.foldedNodeCount >= 40, "most families must be folded");
  assert(flow.meta.withinBudget, "the folded diagram must fit the budget");
});

Deno.test("folding preserves Score conservation (the tail is not lost)", () => {
  const flow = flowFrom(manyFamiliesSnapshot(60));
  // Every family's contribution — including the folded tail — still reaches the
  // Score, so the decomposition remains honest after aggregation.
  approx(flow.meta.sourceFlowTotal, flow.totalScore, 1e-9);
  approx(flow.meta.inboundToOutputs, flow.totalScore, 1e-9);
});

Deno.test("a small snapshot below the per-layer budget folds nothing", () => {
  const flow = flowFrom(smallSnapshot());
  assertEquals(flow.meta.foldedNodeCount, 0);
  assertEquals(flow.nodes.some((n: Any) => n.kind === "other"), false);
});

Deno.test("the flow model is deterministic for identical input", () => {
  const first = flowFrom(scaledSnapshot(30));
  const second = flowFrom(scaledSnapshot(30));
  assertEquals(JSON.stringify(first), JSON.stringify(second));
});

// ---------------------------------------------------------------------------
// Path tracing (Issue #537) — the DOM-free helper behind click/tap-to-trace.
// ---------------------------------------------------------------------------

/**
 * A tiny hand-checkable flow: two families A and B feed hidden H, which feeds
 * the output OUT; ISO is an isolated node with no bands. Only `links` is read by
 * the trace helper, so a synthetic flow gives exact, deterministic control.
 */
function fixtureFlow(): Any {
  return {
    nodes: [
      { id: "A" },
      { id: "B" },
      { id: "H" },
      { id: "OUT" },
      { id: "ISO" },
    ],
    links: [
      { id: "A->H", source: "A", target: "H" },
      { id: "B->H", source: "B", target: "H" },
      { id: "H->OUT", source: "H", target: "OUT" },
    ],
  };
}

const json = (v: unknown) => JSON.stringify(v);

Deno.test("traceNodeFlow returns exactly the reachable upstream and downstream bands", () => {
  const trace = traceNodeFlow(fixtureFlow(), "H");
  // Upstream: both feeder bands. Downstream: the single band to the output.
  assertEquals(json(trace.upstreamLinkIds), json(["A->H", "B->H"]));
  assertEquals(json(trace.downstreamLinkIds), json(["H->OUT"]));
  assertEquals(json(trace.linkIds), json(["A->H", "B->H", "H->OUT"]));
  // Every node on the path, including H itself and the output.
  assertEquals(json(trace.nodeIds), json(["A", "B", "H", "OUT"]));
});

Deno.test("traceNodeFlow follows a family all the way to the output", () => {
  const trace = traceNodeFlow(fixtureFlow(), "A");
  // A has no upstream; downstream reaches H then OUT — the full flow to output.
  assertEquals(json(trace.upstreamLinkIds), json([]));
  assertEquals(json(trace.downstreamLinkIds), json(["A->H", "H->OUT"]));
  assertEquals(json(trace.nodeIds), json(["A", "H", "OUT"]));
});

Deno.test("traceNodeFlow traces an isolated node to itself with no bands", () => {
  const trace = traceNodeFlow(fixtureFlow(), "ISO");
  assertEquals(json(trace.linkIds), json([]));
  assertEquals(json(trace.upstreamLinkIds), json([]));
  assertEquals(json(trace.downstreamLinkIds), json([]));
  assertEquals(json(trace.nodeIds), json(["ISO"]));
});

Deno.test("traceNodeFlow on a real snapshot: the output pulls in every band", () => {
  const flow = flowFrom(smallSnapshot());
  const outputId = flow.meta.outputNodeIds[0];
  const trace = traceNodeFlow(flow, outputId);
  // Everything that reaches the Score is upstream of the output; nothing is
  // downstream of it.
  const allLinkIds = flow.links.map((l: Any) => l.id).sort();
  assertEquals(json(trace.upstreamLinkIds), json(allLinkIds));
  assertEquals(json(trace.downstreamLinkIds), json([]));
});

Deno.test("traceLinkFlow highlights a band and both its endpoints", () => {
  const trace = traceLinkFlow(fixtureFlow(), "A->H");
  assertEquals(json(trace.linkIds), json(["A->H"]));
  assertEquals(json(trace.nodeIds), json(["A", "H"]));
});

Deno.test("traceLinkFlow returns an empty trace for an unknown band", () => {
  const trace = traceLinkFlow(fixtureFlow(), "does-not-exist");
  assertEquals(json(trace.linkIds), json([]));
  assertEquals(json(trace.nodeIds), json([]));
});

Deno.test("the trace helpers tolerate a flow with no links", () => {
  assertEquals(
    json(traceNodeFlow({}, "X")),
    json({
      nodeIds: ["X"],
      linkIds: [],
      upstreamLinkIds: [],
      downstreamLinkIds: [],
    }),
  );
  assertEquals(
    json(traceLinkFlow({}, "X")),
    json({ nodeIds: [], linkIds: [] }),
  );
});

Deno.test("buildSankeyFlow fails loudly on a missing or malformed model", () => {
  for (const bad of [null, undefined, {}, { nodes: [], edges: [] }]) {
    let threw = false;
    try {
      buildSankeyFlow(bad as Any);
    } catch {
      threw = true;
    }
    assert(threw, "a model without nodes/edges/layers must throw");
  }
});
