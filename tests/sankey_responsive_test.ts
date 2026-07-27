/**
 * Sankey phone-friendly layout tests (Issue #540).
 *
 * The Sankey view as first merged was laid out for a desktop canvas and merely
 * scaled down on a phone: 12 nodes per layer, 22-character labels, 1.5 px bands
 * and an `h >= 8` label threshold that dropped most labels once the diagram was
 * squeezed. Nothing in CI could catch a revert to that, because the layout
 * decisions were computed inline while building SVG.
 *
 * These tests pin the narrow-viewport decisions the renderer now makes:
 *
 *   1. the breakpoint itself, including the desktop constants staying exactly
 *      as they were (the "desktop layout is unchanged" acceptance criterion);
 *   2. the responsive per-layer fold budget;
 *   3. the label-visibility threshold at a phone width — measurably more of the
 *      diagram is labelled on a phone than the desktop layout would manage in
 *      the same space.
 */

import { assert, assertEquals } from "./test_helpers.ts";

import { buildAggregatedGraphModel } from "../docs/shared/aggregated_graph_model.js";
import {
  buildSankeyFlow,
  DEFAULT_MAX_NODES_PER_LAYER,
} from "../docs/shared/sankey_flow.js";
import {
  PHONE_MAX_WIDTH,
  sankeyLayoutForWidth,
  sankeyViewWidth,
} from "../docs/shared/sankey_responsive.js";
import {
  computeSankeyGeometry,
  truncateLabel,
} from "../docs/shared/sankey_layout.js";

// deno-lint-ignore no-explicit-any
type Any = any;

const PHONE_WIDTH = 390; // iPhone 14 CSS width.
const DESKTOP_WIDTH = 1440;

/**
 * A snapshot wide enough to exercise folding: 40 ungrouped observations (so
 * layer 0 explodes into 40 single-observation families) feeding six hidden
 * neurons into one output.
 */
function wideSnapshot(): unknown {
  const inputs = 40;
  const hidden = 6;
  const neurons: Any[] = [];
  const synapses: Any[] = [];
  const impacts: Record<string, number> = { "output-0": 1 };
  const tooltips: Record<string, unknown> = {};

  for (let h = 0; h < hidden; h++) {
    neurons.push({
      uuid: `hidden-${h}`,
      type: "hidden",
      squash: "TANH",
      bias: 0,
    });
    impacts[`hidden-${h}`] = 1 / (h + 1);
    synapses.push({
      fromUuid: `hidden-${h}`,
      toUuid: "output-0",
      weight: 1 / (h + 1),
    });
  }
  neurons.push({
    uuid: "output-0",
    type: "output",
    squash: "IDENTITY",
    bias: 0,
  });
  for (let i = 0; i < inputs; i++) {
    // A distinct group per input → a distinct family per observation, which is
    // what the published snapshot's 2,132 ungrouped observations produce.
    tooltips[`input-${i}`] = {
      label: `Signal number ${i} from the market feed`,
      description: `Independent signal ${i}`,
      group: `fam-${i}`,
    };
    synapses.push({
      fromUuid: `input-${i}`,
      toUuid: `hidden-${i % hidden}`,
      weight: 1 / (i + 1),
    });
  }

  return {
    tooltips,
    creature: { input: inputs, output: 1, neurons, synapses },
    derived: { impactsByNeuronUuid: impacts },
  };
}

function flowFor(maxNodesPerLayer: number) {
  const model = buildAggregatedGraphModel(wideSnapshot()) as Any;
  return buildSankeyFlow(model, { maxNodesPerLayer }) as Any;
}

// ── Breakpoint ────────────────────────────────────────────────────────────

Deno.test("the phone layout applies at and below the 640px breakpoint", () => {
  assertEquals(PHONE_MAX_WIDTH, 640);
  assertEquals(sankeyLayoutForWidth(PHONE_WIDTH).isNarrow, true);
  assertEquals(sankeyLayoutForWidth(PHONE_MAX_WIDTH).isNarrow, true);
  assertEquals(sankeyLayoutForWidth(PHONE_MAX_WIDTH + 1).isNarrow, false);
  assertEquals(sankeyLayoutForWidth(DESKTOP_WIDTH).isNarrow, false);
});

Deno.test("the desktop layout is unchanged by the phone work", () => {
  const desktop = sankeyLayoutForWidth(DESKTOP_WIDTH);
  assertEquals(desktop.maxNodesPerLayer, DEFAULT_MAX_NODES_PER_LAYER);
  assertEquals(desktop.viewHeight, 620);
  assertEquals(desktop.padX, 140);
  assertEquals(desktop.padY, 24);
  assertEquals(desktop.nodeWidth, 16);
  assertEquals(desktop.nodeGap, 10);
  assertEquals(desktop.minBand, 1.5);
  assertEquals(desktop.labelMinHeight, 8);
  assertEquals(desktop.labelMaxChars, 22);
  assertEquals(sankeyViewWidth(desktop, 1), 640);
  assertEquals(sankeyViewWidth(desktop, 4), 880);
});

Deno.test("a missing viewport width fails loudly rather than guessing", () => {
  for (const bad of [0, -1, Number.NaN, undefined, null, "wide"]) {
    let threw = false;
    try {
      sankeyLayoutForWidth(bad as Any);
    } catch {
      threw = true;
    }
    assert(threw, `sankeyLayoutForWidth(${String(bad)}) must throw`);
  }
});

// ── Responsive per-layer budget ───────────────────────────────────────────

Deno.test("the phone layout keeps fewer nodes per layer than the desktop", () => {
  const phone = sankeyLayoutForWidth(PHONE_WIDTH);
  const desktop = sankeyLayoutForWidth(DESKTOP_WIDTH);
  assert(
    phone.maxNodesPerLayer < desktop.maxNodesPerLayer,
    "a phone must fold more aggressively than a desktop",
  );
  assert(phone.maxNodesPerLayer >= 4, "folding to fewer than 4 hides too much");
});

Deno.test("the phone budget is what the flow actually folds to", () => {
  const phone = sankeyLayoutForWidth(PHONE_WIDTH);
  const flow = flowFor(phone.maxNodesPerLayer);
  const perLayer = new Map<number, number>();
  for (const node of flow.nodes) {
    perLayer.set(node.layer, (perLayer.get(node.layer) ?? 0) + 1);
  }
  for (const [layer, count] of perLayer) {
    // The budget counts kept nodes; the folded tail adds at most one "other"
    // node per layer on top of it.
    assert(
      count <= phone.maxNodesPerLayer + 1,
      `layer ${layer} kept ${count} nodes, above the phone budget`,
    );
  }
  // 40 families fold to the budget plus the one "other" node holding the tail.
  const layerZero = flow.nodes.filter((n: Any) => n.layer === 0);
  assertEquals(layerZero.length, phone.maxNodesPerLayer + 1);
  assertEquals(layerZero.filter((n: Any) => n.kind === "other").length, 1);
});

Deno.test("the phone layout narrows the view and widens the tap targets", () => {
  const phone = sankeyLayoutForWidth(PHONE_WIDTH);
  const desktop = sankeyLayoutForWidth(DESKTOP_WIDTH);
  assert(
    sankeyViewWidth(phone, 4) < sankeyViewWidth(desktop, 4),
    "a phone view must be narrower than the desktop canvas",
  );
  assert(
    phone.minBand > desktop.minBand,
    "the thinnest band must be thicker on a phone",
  );
  assert(
    phone.labelMaxChars < desktop.labelMaxChars,
    "labels must be shorter on a phone",
  );
});

// ── Label visibility at a phone width ─────────────────────────────────────

Deno.test("the phone layout labels more of the diagram than the desktop one would", () => {
  const phone = sankeyLayoutForWidth(PHONE_WIDTH);
  const desktop = sankeyLayoutForWidth(DESKTOP_WIDTH);

  const phoneGeom = computeSankeyGeometry(
    flowFor(phone.maxNodesPerLayer),
    phone,
  );
  // The regression being guarded: the desktop layout, drawn into a phone.
  const desktopGeom = computeSankeyGeometry(
    flowFor(desktop.maxNodesPerLayer),
    desktop,
  );

  const share = (g: Any) =>
    g.nodes.filter((n: Any) => n.showLabel).length / g.nodes.length;

  assert(
    share(phoneGeom) > share(desktopGeom),
    `phone labelled ${share(phoneGeom)}, desktop ${share(desktopGeom)}`,
  );
  assert(
    share(phoneGeom) >= 0.8,
    `at least 80% of phone bands must be labelled, got ${share(phoneGeom)}`,
  );
});

Deno.test("every phone band clears the phone band floor", () => {
  const phone = sankeyLayoutForWidth(PHONE_WIDTH);
  const geometry = computeSankeyGeometry(
    flowFor(phone.maxNodesPerLayer),
    phone,
  );
  assert(geometry.nodes.length > 0, "the fixture must render some nodes");
  for (const node of geometry.nodes) {
    assert(
      node.h >= phone.minBand,
      `node ${node.id} is ${node.h} tall, below the ${phone.minBand} floor`,
    );
    assertEquals(node.width, phone.nodeWidth);
  }
  for (const link of geometry.links) {
    assert(link.thickness >= phone.minBand, `band ${link.id} is too thin`);
  }
});

Deno.test("geometry stays inside the view box it declares", () => {
  for (const width of [PHONE_WIDTH, DESKTOP_WIDTH]) {
    const layout = sankeyLayoutForWidth(width);
    const geometry = computeSankeyGeometry(
      flowFor(layout.maxNodesPerLayer),
      layout,
    );
    for (const node of geometry.nodes) {
      assert(node.x >= 0, `node ${node.id} sits left of the view`);
      assert(
        node.x + node.width <= geometry.viewWidth,
        `node ${node.id} overruns the view width`,
      );
      assert(node.y >= 0, `node ${node.id} sits above the view`);
      assert(
        node.y + node.h <= geometry.viewHeight + 1e-6,
        `node ${node.id} overruns the view height`,
      );
    }
  }
});

Deno.test("labels are truncated to the live layout's budget", () => {
  assertEquals(truncateLabel("short", 22), "short");
  assertEquals(truncateLabel("a".repeat(30), 12).length, 12);
  assert(truncateLabel("a".repeat(30), 12).endsWith("…"));
  // A phone truncates a long observation name harder than a desktop.
  const name = "Reserve Bank overnight cash rate";
  const phone = sankeyLayoutForWidth(PHONE_WIDTH);
  const desktop = sankeyLayoutForWidth(DESKTOP_WIDTH);
  assert(
    truncateLabel(name, phone.labelMaxChars).length <
      truncateLabel(name, desktop.labelMaxChars).length,
  );
});

Deno.test("computeSankeyGeometry fails loudly on a malformed flow or layout", () => {
  const layout = sankeyLayoutForWidth(DESKTOP_WIDTH);
  let threw = false;
  try {
    computeSankeyGeometry(null as Any, layout);
  } catch {
    threw = true;
  }
  assert(threw, "a missing flow must throw");

  threw = false;
  try {
    computeSankeyGeometry({ nodes: [], links: [] } as Any, null as Any);
  } catch {
    threw = true;
  }
  assert(threw, "missing layout constants must throw");
});

Deno.test("an empty flow lays out to nothing rather than throwing", () => {
  const layout = sankeyLayoutForWidth(PHONE_WIDTH);
  const geometry = computeSankeyGeometry(
    { nodes: [], links: [] } as Any,
    layout,
  );
  assertEquals(geometry.nodes.length, 0);
  assertEquals(geometry.links.length, 0);
  assertEquals(geometry.viewWidth, layout.minViewWidth);
});
