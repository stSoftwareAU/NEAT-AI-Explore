/**
 * Layered 2D DAG view tests (Issue #525).
 *
 * The DAG view renders the aggregated layered graph model (Issue #524) as a
 * left-to-right diagram: observation families on the left, hidden layers in
 * topological order, the output on the right. These tests pin the contract the
 * view depends on:
 *
 *  - layering puts observation families in the leftmost column and the output
 *    node in the rightmost;
 *  - node radius and link width stay clamped to the shared
 *    `TOPO_MIN/MAX_NODE_R` / `TOPO_MIN/MAX_LINK_W` bounds even for extreme
 *    (huge, negative, non-finite) impact values;
 *  - tooltip content comes from `extractTooltips` in `docs/shared/ui_helpers.js`.
 */

import { approx, assert, assertEquals } from "./test_helpers.ts";

import { buildAggregatedGraphModel } from "../docs/shared/aggregated_graph_model.js";
import { extractTooltips } from "../docs/shared/ui_helpers.js";
import {
  TOPO_MAX_LINK_W,
  TOPO_MAX_NODE_R,
  TOPO_MIN_LINK_W,
  TOPO_MIN_NODE_R,
} from "../docs/shared/topology_diagram.js";
import {
  assignDagColumns,
  buildDagNodeTooltip,
  computeDagLayout,
  dagLayoutToSvgString,
  dagLinkWidth,
  dagNodeRadius,
} from "../docs/shared/dag_layout.js";

// deno-lint-ignore no-explicit-any
type Any = any;

/**
 * Three observation families feeding three hidden neurons and one output.
 * `hidden-C` is deliberately near-zero impact so the collapse threshold has
 * something to fold away.
 */
function fixtureSnapshot(): Any {
  return {
    tooltips: {
      "input-0": {
        label: "Cash rate",
        group: "rates",
        description: "RBA overnight cash rate",
      },
      "input-1": {
        label: "Bond yield",
        group: "rates",
        description: "10-year Commonwealth bond yield",
      },
      "input-2": {
        label: "ASX 200 close",
        group: "equities",
        description: "Daily close of the ASX 200 index",
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
        { fromUuid: "hidden-B", toUuid: "output-0", weight: -1 },
        { fromUuid: "hidden-C", toUuid: "output-0", weight: 0.01 },
      ],
    },
    derived: {
      impactsByNeuronUuid: {
        "output-0": 1,
        "hidden-A": 0.7,
        "hidden-B": 0.29,
        "hidden-C": 0.0001,
      },
    },
  };
}

function buildLayout(options: Record<string, unknown> = {}): Any {
  const snapshot = fixtureSnapshot();
  const model = buildAggregatedGraphModel(snapshot, {
    collapseThreshold: 0,
  });
  return computeDagLayout(model, { snapshot, ...options });
}

// ---------------------------------------------------------------------------
// (a) Layering — families leftmost, output rightmost.
// ---------------------------------------------------------------------------

Deno.test("DAG layout puts every observation family in the leftmost column", () => {
  const layout = buildLayout();
  const familyIds = layout.nodes
    .filter((n: Any) => n.kind === "family")
    .map((n: Any) => n.id)
    .sort();

  assert(familyIds.length >= 2, "fixture should produce ≥2 families");
  for (const node of layout.nodes as Any[]) {
    if (node.kind !== "family") continue;
    assertEquals(
      node.column,
      0,
      `family ${node.id} must sit in column 0, got ${node.column}`,
    );
  }
  assertEquals(
    layout.columns[0].nodeIds.slice().sort().join(","),
    familyIds.join(","),
    "column 0 must contain exactly the observation families",
  );
});

Deno.test("DAG layout puts the output node in the rightmost column", () => {
  const layout = buildLayout();
  const output = layout.nodes.find((n: Any) => n.isOutput);
  assert(output, "layout should contain an output node");
  assertEquals(
    output.column,
    layout.columnCount - 1,
    "output must sit in the final column",
  );

  const maxX = Math.max(...layout.nodes.map((n: Any) => n.x));
  assertEquals(output.x, maxX, "output must be the right-most node");

  const minX = Math.min(...layout.nodes.map((n: Any) => n.x));
  for (const node of layout.nodes as Any[]) {
    if (node.kind === "family") assertEquals(node.x, minX);
  }
});

Deno.test("DAG layout keeps hidden neurons strictly between families and output", () => {
  const layout = buildLayout();
  const hidden = layout.nodes.filter((n: Any) =>
    n.kind !== "family" && !n.isOutput
  );
  assert(hidden.length > 0, "fixture should keep hidden neurons");
  for (const node of hidden as Any[]) {
    assert(
      node.column > 0 && node.column < layout.columnCount - 1,
      `${node.id} should sit between the family and output columns, got column ${node.column}`,
    );
  }
});

Deno.test("assignDagColumns still separates families and output in a degenerate 2-layer model", () => {
  // A model whose topological layer count is smaller than the number of
  // visual columns the view needs: families and the output would otherwise
  // collide in one column.
  const model = {
    nodes: [
      { id: "family:rates", kind: "family", layer: 0 },
      { id: "neuron:hidden-A", kind: "neuron", layer: 0 },
      { id: "neuron:output-0", kind: "neuron", layer: 1 },
    ],
    edges: [],
    layers: [],
    meta: { layerCount: 2, outputNodeIds: ["neuron:output-0"] },
  };
  const { columnByNodeId, columnCount } = assignDagColumns(model);
  assertEquals(columnByNodeId.get("family:rates"), 0);
  assertEquals(columnByNodeId.get("neuron:output-0"), columnCount - 1);
  assertEquals(columnByNodeId.get("neuron:hidden-A"), 1);
  assertEquals(columnCount, 3);
});

Deno.test("DAG layout column labels name the observation and output columns", () => {
  const layout = buildLayout();
  assertEquals(layout.columns[0].label, "Observations");
  assertEquals(layout.columns[layout.columnCount - 1].label, "Output");
});

// ---------------------------------------------------------------------------
// (b) Impact encodings stay clamped to the shared topology bounds.
// ---------------------------------------------------------------------------

Deno.test("dagNodeRadius clamps extreme impact values to the topology bounds", () => {
  const cases: Array<[number, number]> = [
    [1e18, 1],
    [Number.MAX_VALUE, 0.001],
    [-1e18, 1],
    [Number.NaN, 1],
    [Number.POSITIVE_INFINITY, 1],
    [0, 0],
    [1, Number.NaN],
  ];
  for (const [impact, maxImpact] of cases) {
    const r = dagNodeRadius(impact, maxImpact);
    assert(
      Number.isFinite(r) && r >= TOPO_MIN_NODE_R && r <= TOPO_MAX_NODE_R,
      `radius for (${impact}, ${maxImpact}) must stay within [${TOPO_MIN_NODE_R}, ${TOPO_MAX_NODE_R}], got ${r}`,
    );
  }
  assertEquals(dagNodeRadius(5, 5), TOPO_MAX_NODE_R);
  assertEquals(dagNodeRadius(0, 5), TOPO_MIN_NODE_R);
});

Deno.test("dagLinkWidth clamps extreme contribution values to the topology bounds", () => {
  const cases: Array<[number, number]> = [
    [1e18, 1],
    [-1e18, 1],
    [Number.NaN, 1],
    [Number.NEGATIVE_INFINITY, 1],
    [0, 0],
  ];
  for (const [impact, maxImpact] of cases) {
    const w = dagLinkWidth(impact, maxImpact);
    assert(
      Number.isFinite(w) && w >= TOPO_MIN_LINK_W && w <= TOPO_MAX_LINK_W,
      `link width for (${impact}, ${maxImpact}) must stay within [${TOPO_MIN_LINK_W}, ${TOPO_MAX_LINK_W}], got ${w}`,
    );
  }
  assertEquals(dagLinkWidth(3, 3), TOPO_MAX_LINK_W);
  assertEquals(dagLinkWidth(0, 3), TOPO_MIN_LINK_W);
});

Deno.test("DAG layout radii and link widths stay clamped for an extreme-impact model", () => {
  const snapshot = fixtureSnapshot() as Any;
  snapshot.derived.impactsByNeuronUuid = {
    "output-0": 1,
    "hidden-A": 1e18,
    "hidden-B": -1e12,
    "hidden-C": 0,
  };
  const model = buildAggregatedGraphModel(snapshot, { collapseThreshold: 0 });
  const layout = computeDagLayout(model, { snapshot });

  for (const node of layout.nodes as Any[]) {
    assert(
      node.r >= TOPO_MIN_NODE_R && node.r <= TOPO_MAX_NODE_R,
      `${node.id} radius ${node.r} out of bounds`,
    );
    assert(
      node.fillOpacity > 0 && node.fillOpacity <= 1,
      `${node.id} fill opacity ${node.fillOpacity} out of bounds`,
    );
  }
  for (const edge of layout.edges as Any[]) {
    assert(
      edge.width >= TOPO_MIN_LINK_W && edge.width <= TOPO_MAX_LINK_W,
      `${edge.id} width ${edge.width} out of bounds`,
    );
  }
});

Deno.test("DAG layout encodes larger impact as a larger node", () => {
  const layout = buildLayout();
  const byId = new Map(layout.nodes.map((n: Any) => [n.id, n]));
  const strong = byId.get("neuron:hidden-A") as Any;
  const weak = byId.get("neuron:hidden-C") as Any;
  assert(strong && weak, "fixture should keep hidden-A and hidden-C");
  assert(
    strong.r > weak.r,
    `hidden-A (impact ${strong.impact}) should render larger than hidden-C (impact ${weak.impact})`,
  );
  assert(
    strong.fillOpacity > weak.fillOpacity,
    "higher impact should render a stronger colour",
  );
});

Deno.test("DAG layout column shares sum to 1 within each populated column", () => {
  const layout = buildLayout();
  for (const column of layout.columns as Any[]) {
    if (column.nodeIds.length === 0) continue;
    const total = layout.nodes
      .filter((n: Any) => n.column === column.index)
      .reduce((acc: number, n: Any) => acc + n.columnShare, 0);
    approx(total, 1, 1e-9, `column ${column.index} shares should sum to 1`);
  }
});

// ---------------------------------------------------------------------------
// (c) Tooltips come from extractTooltips.
// ---------------------------------------------------------------------------

Deno.test("DAG node tooltips carry the observation summaries from extractTooltips", () => {
  const snapshot = fixtureSnapshot();
  const { labels, descriptions } = extractTooltips(snapshot);
  const layout = buildLayout();

  const rates = layout.nodes.find((n: Any) => n.id === "family:rates") as Any;
  assert(rates, "fixture should produce a 'rates' family node");
  assert(
    rates.tooltip.includes(descriptions["input-0"]),
    `family tooltip should include the Tooltips.json summary, got: ${rates.tooltip}`,
  );
  assert(
    rates.tooltip.includes(labels["input-0"]),
    "family tooltip should include the observation label",
  );
});

Deno.test("buildDagNodeTooltip renders label — description for each member", () => {
  const { labels, descriptions } = extractTooltips(fixtureSnapshot());
  const tooltip = buildDagNodeTooltip({
    node: {
      id: "family:rates",
      kind: "family",
      label: "rates",
      impact: 0.5,
      members: ["input-0", "input-1"],
      memberCount: 2,
    },
    labels,
    descriptions,
    columnShare: 0.25,
  });
  assert(tooltip.includes("rates"), "tooltip should name the family");
  assert(
    tooltip.includes("2 observations"),
    `tooltip should report the member count, got: ${tooltip}`,
  );
  assert(
    tooltip.includes("Cash rate — RBA overnight cash rate"),
    `tooltip should use buildObservationTooltip formatting, got: ${tooltip}`,
  );
  assert(tooltip.includes("25.0%"), "tooltip should report the column share");
});

Deno.test("buildDagNodeTooltip degrades to the label when no summary is known", () => {
  const tooltip = buildDagNodeTooltip({
    node: {
      id: "neuron:hidden-A",
      kind: "neuron",
      label: "hidden-A",
      impact: 0.7,
      members: ["hidden-A"],
      memberCount: 1,
    },
    labels: {},
    descriptions: {},
    columnShare: 1,
  });
  assert(tooltip.includes("hidden-A"), "tooltip should still name the neuron");
  assert(!tooltip.includes("—  "), "tooltip should not leave a dangling dash");
});

// ---------------------------------------------------------------------------
// SVG rendering.
// ---------------------------------------------------------------------------

Deno.test("dagLayoutToSvgString renders one group per node and per edge", () => {
  const layout = buildLayout();
  const svg = dagLayoutToSvgString(layout);

  assert(svg.startsWith("<svg"), "should render an <svg> root");
  assert(svg.includes(`viewBox="0 0 ${layout.width} ${layout.height}"`));
  assertEquals(
    (svg.match(/class="dagNode"/g) ?? []).length,
    layout.nodes.length,
  );
  assertEquals(
    (svg.match(/class="dagEdge"/g) ?? []).length,
    layout.edges.length,
  );
  assertEquals(
    (svg.match(/<title>/g) ?? []).length,
    layout.nodes.length + layout.edges.length,
  );
});

Deno.test("dagLayoutToSvgString escapes markup in labels and tooltips", () => {
  const snapshot = fixtureSnapshot() as Any;
  snapshot.tooltips["input-2"] = {
    label: "<script>alert(1)</script>",
    group: "<img src=x onerror=alert(1)>",
    description: 'a "quoted" & dangerous summary',
  };
  const model = buildAggregatedGraphModel(snapshot, { collapseThreshold: 0 });
  const svg = dagLayoutToSvgString(computeDagLayout(model, { snapshot }));

  assert(!svg.includes("<script>"), "must not emit a raw <script> tag");
  assert(!svg.includes("<img"), "must not emit a raw <img> element");
  assert(svg.includes("&lt;script&gt;"), "should escape the injected markup");
  assert(
    svg.includes("&quot;quoted&quot;") || svg.includes("&amp;"),
    "should escape quotes and ampersands in tooltip text",
  );
});

Deno.test("computeDagLayout is deterministic for the same model", () => {
  const a = dagLayoutToSvgString(buildLayout());
  const b = dagLayoutToSvgString(buildLayout());
  assertEquals(a, b, "the same model must render identical SVG");
});

Deno.test("computeDagLayout renders collapsed low-impact aggregates", () => {
  const snapshot = fixtureSnapshot();
  const model = buildAggregatedGraphModel(snapshot, { collapseThreshold: 0.5 });
  const layout = computeDagLayout(model, { snapshot });
  const collapsed = layout.nodes.filter((n: Any) => n.kind === "collapsed");
  assert(
    collapsed.length > 0,
    "a 50% collapse threshold should fold the weak neurons into an aggregate",
  );
  for (const node of collapsed as Any[]) {
    assert(
      node.tooltip.includes("low-impact"),
      `collapsed tooltip should explain the fold, got: ${node.tooltip}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Readability at full scale — per-column folding.
// ---------------------------------------------------------------------------

/** A model with `count` sibling nodes in one column, all feeding the output. */
function wideModel(count: number): Any {
  const nodes: Any[] = [{
    id: "family:rates",
    kind: "family",
    label: "rates",
    layer: 0,
    members: ["input-0"],
    memberCount: 1,
    impact: 1,
  }];
  const edges: Any[] = [];
  for (let i = 0; i < count; i++) {
    const id = `neuron:hidden-${i}`;
    nodes.push({
      id,
      kind: "neuron",
      label: `hidden-${i}`,
      layer: 1,
      members: [`hidden-${i}`],
      memberCount: 1,
      impact: (count - i) / count,
    });
    edges.push({
      id: `family:rates=>${id}`,
      from: "family:rates",
      to: id,
      weight: 1,
      absWeight: 1,
      impact: (count - i) / count,
      members: [`input-0→hidden-${i}`],
      memberCount: 1,
    });
    edges.push({
      id: `${id}=>neuron:output-0`,
      from: id,
      to: "neuron:output-0",
      weight: 1,
      absWeight: 1,
      impact: (count - i) / count,
      members: [`hidden-${i}→output-0`],
      memberCount: 1,
    });
  }
  nodes.push({
    id: "neuron:output-0",
    kind: "neuron",
    label: "output-0",
    layer: 2,
    members: ["output-0"],
    memberCount: 1,
    impact: 1,
  });
  return {
    nodes,
    edges,
    layers: [],
    families: [],
    meta: { layerCount: 3, outputNodeIds: ["neuron:output-0"] },
  };
}

Deno.test("computeDagLayout folds a wide column down to the row budget", () => {
  const layout: Any = computeDagLayout(wideModel(120), {
    maxNodesPerColumn: 8,
  });
  const column = layout.nodes.filter((n: Any) => n.column === 1);
  assertEquals(column.length, 8, "column should be capped at the row budget");

  const fold = column.find((n: Any) => n.id.startsWith("overflow:"));
  assert(fold, "the folded remainder should render as one aggregate node");
  assertEquals(fold.kind, "collapsed");
  assertEquals(fold.memberCount, 113, "fold should keep every folded member");
  assertEquals(layout.meta.foldedNodeCount, 113);
  assert(
    fold.label.includes("113"),
    `fold label must state how many nodes were folded, got: ${fold.label}`,
  );
});

Deno.test("computeDagLayout re-points edges of folded nodes onto the aggregate", () => {
  const layout: Any = computeDagLayout(wideModel(120), {
    maxNodesPerColumn: 8,
  });
  const rendered = new Set(layout.nodes.map((n: Any) => n.id));
  for (const edge of layout.edges as Any[]) {
    assert(rendered.has(edge.from), `dangling edge source ${edge.from}`);
    assert(rendered.has(edge.to), `dangling edge target ${edge.to}`);
  }
  const foldId = layout.nodes.find((n: Any) => n.id.startsWith("overflow:")).id;
  const intoFold = layout.edges.filter((e: Any) => e.to === foldId);
  assertEquals(intoFold.length, 1, "merged edges must not duplicate");
  assertEquals(
    intoFold[0].memberCount,
    113,
    "the merged edge should keep every member synapse",
  );
});

Deno.test("computeDagLayout leaves a column under the row budget untouched", () => {
  const layout: Any = computeDagLayout(wideModel(4), { maxNodesPerColumn: 8 });
  assertEquals(
    layout.nodes.filter((n: Any) => n.id.startsWith("overflow:")).length,
    0,
  );
  assertEquals(layout.meta.foldedNodeCount, 0);
});

Deno.test("computeDagLayout throws when the model has no nodes", () => {
  let threw = false;
  try {
    computeDagLayout({ nodes: [], edges: [], layers: [], meta: {} });
  } catch {
    threw = true;
  }
  assert(threw, "an empty model is a fault to surface, not a blank diagram");
});
