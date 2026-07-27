/**
 * Sankey responsive-layout tests (Issue #540).
 *
 * #540 makes the Sankey view phone-friendly: zoom/pan over the diagram and
 * width-based layout decisions so a phone-width viewport is readable rather than
 * a shrunk-to-fit desktop canvas. Following the split that keeps `sankey_flow.js`
 * unit-tested and `sankey.js` a thin DOM adapter, the narrow-viewport *decisions*
 * the renderer makes — the per-layer node budget, the column width, the
 * label-visibility threshold and the zoom/pan transform maths — live DOM-free in
 * `sankey_layout.js` so they are pinned here.
 *
 * A regression that reverts to the desktop-only layout (e.g. always drawing the
 * full 12-per-layer budget at a phone width) fails these before merge — the
 * failure-detection contract from the issue.
 */

import { approx, assert, assertEquals } from "./test_helpers.ts";

import {
  clampZoom,
  DESKTOP_COLUMN_WIDTH,
  isPhoneWidth,
  LABEL_MIN_BAND,
  MAX_ZOOM,
  MIN_ZOOM,
  PHONE_BREAKPOINT,
  PHONE_COLUMN_WIDTH,
  PHONE_MAX_NODES_PER_LAYER,
  responsiveColumnWidth,
  responsiveNodesPerLayer,
  shouldDrawLabel,
  zoomAbout,
} from "../docs/shared/sankey_layout.js";
import { buildAggregatedGraphModel } from "../docs/shared/aggregated_graph_model.js";
import {
  buildSankeyFlow,
  DEFAULT_MAX_NODES_PER_LAYER,
} from "../docs/shared/sankey_flow.js";

// deno-lint-ignore no-explicit-any
type Any = any;

// A phone-width and a desktop-width sample either side of the breakpoint.
const PHONE_WIDTH = 360; // iPhone-class CSS width
const DESKTOP_WIDTH = 1280;

Deno.test("isPhoneWidth flips at the breakpoint and treats the boundary as phone", () => {
  assertEquals(isPhoneWidth(PHONE_WIDTH), true);
  assertEquals(isPhoneWidth(DESKTOP_WIDTH), false);
  // The breakpoint itself is a phone width (inclusive), one past it is not.
  assertEquals(isPhoneWidth(PHONE_BREAKPOINT), true);
  assertEquals(isPhoneWidth(PHONE_BREAKPOINT + 1), false);
});

Deno.test("isPhoneWidth treats an unknown/zero width as not-phone (desktop default)", () => {
  // No window (SSR/headless), a zero, or a NaN must never fold more aggressively
  // by accident — the safe default is the roomy desktop layout.
  assertEquals(isPhoneWidth(0), false);
  assertEquals(isPhoneWidth(NaN), false);
  assertEquals(isPhoneWidth(undefined as unknown as number), false);
});

Deno.test("responsiveNodesPerLayer folds to a smaller budget on a phone", () => {
  assertEquals(responsiveNodesPerLayer(PHONE_WIDTH), PHONE_MAX_NODES_PER_LAYER);
  assertEquals(
    responsiveNodesPerLayer(DESKTOP_WIDTH),
    DEFAULT_MAX_NODES_PER_LAYER,
  );
  // The phone budget must actually be smaller — otherwise the layout is not
  // responsive at all and labels stay illegible.
  assert(
    PHONE_MAX_NODES_PER_LAYER < DEFAULT_MAX_NODES_PER_LAYER,
    "the phone budget must keep fewer, taller nodes per layer",
  );
});

Deno.test("responsiveNodesPerLayer falls back to desktop for an unknown width", () => {
  assertEquals(responsiveNodesPerLayer(0), DEFAULT_MAX_NODES_PER_LAYER);
  assertEquals(
    responsiveNodesPerLayer(undefined as unknown as number),
    DEFAULT_MAX_NODES_PER_LAYER,
  );
});

Deno.test("responsiveColumnWidth widens columns on a phone so panned labels have room", () => {
  assertEquals(responsiveColumnWidth(PHONE_WIDTH), PHONE_COLUMN_WIDTH);
  assertEquals(responsiveColumnWidth(DESKTOP_WIDTH), DESKTOP_COLUMN_WIDTH);
  assert(
    PHONE_COLUMN_WIDTH >= DESKTOP_COLUMN_WIDTH,
    "phone columns must not be narrower than desktop",
  );
});

Deno.test("shouldDrawLabel gates a label on the minimum band height", () => {
  assertEquals(shouldDrawLabel(LABEL_MIN_BAND), true);
  assertEquals(shouldDrawLabel(LABEL_MIN_BAND + 5), true);
  assertEquals(shouldDrawLabel(LABEL_MIN_BAND - 0.1), false);
  assertEquals(shouldDrawLabel(0), false);
});

Deno.test("clampZoom keeps the scale inside [MIN_ZOOM, MAX_ZOOM]", () => {
  assertEquals(clampZoom(1), 1);
  assertEquals(clampZoom(MIN_ZOOM - 5), MIN_ZOOM);
  assertEquals(clampZoom(MAX_ZOOM + 5), MAX_ZOOM);
  // A non-finite scale collapses to the floor rather than propagating NaN.
  assertEquals(clampZoom(NaN), MIN_ZOOM);
  // Custom bounds are honoured.
  assertEquals(clampZoom(10, 2, 4), 4);
});

Deno.test("zoomAbout keeps the focal point fixed under the cursor", () => {
  const start = { scale: 1, x: 0, y: 0 };
  const focalX = 300;
  const focalY = 200;
  // The content point currently under the focal point (in content coords).
  const contentX = (focalX - start.x) / start.scale;
  const contentY = (focalY - start.y) / start.scale;

  const zoomed = zoomAbout(start, 2, focalX, focalY);
  assertEquals(zoomed.scale, 2);
  // After zooming, the SAME content point must still map to the focal point.
  approx(zoomed.scale * contentX + zoomed.x, focalX, 1e-9);
  approx(zoomed.scale * contentY + zoomed.y, focalY, 1e-9);
});

Deno.test("zoomAbout clamps at MAX_ZOOM without drifting the focal point", () => {
  const start = { scale: MAX_ZOOM, x: 40, y: -15 };
  const focalX = 120;
  const focalY = 90;
  const zoomed = zoomAbout(start, 4, focalX, focalY);
  // Already at the ceiling — scale stays put and the transform does not move.
  assertEquals(zoomed.scale, MAX_ZOOM);
  approx(zoomed.x, start.x, 1e-9);
  approx(zoomed.y, start.y, 1e-9);
});

Deno.test("zoomAbout clamps at MIN_ZOOM when zooming out past the floor", () => {
  const start = { scale: 1.2, x: 10, y: 10 };
  const zoomed = zoomAbout(start, 0.1, 50, 50);
  assertEquals(zoomed.scale, MIN_ZOOM);
});

// ---------------------------------------------------------------------------
// Integration: the responsive budget actually changes what the renderer draws.
// ---------------------------------------------------------------------------

/**
 * A snapshot whose observations carry a distinct group each, so layer 0
 * explodes into many single-observation families — the case where the per-layer
 * budget decides how many bands (and thus labels) a column shows.
 */
function manyFamiliesSnapshot(inputCount = 30): unknown {
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
    tooltips[`input-${i}`] = {
      label: `Signal ${i}`,
      description: `Independent signal ${i}`,
      group: `fam-${i}`,
    };
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

function layer0Count(flow: Any): number {
  return flow.nodes.filter((n: Any) => n.layer === 0).length;
}

Deno.test("a phone-width budget keeps fewer layer-0 bands than a desktop budget", () => {
  const model = buildAggregatedGraphModel(manyFamiliesSnapshot(30));

  const phone = buildSankeyFlow(model, {
    maxNodesPerLayer: responsiveNodesPerLayer(PHONE_WIDTH),
  });
  const desktop = buildSankeyFlow(model, {
    maxNodesPerLayer: responsiveNodesPerLayer(DESKTOP_WIDTH),
  });

  // The phone layout keeps at most its budget (+1 folded "other") per layer, and
  // strictly fewer bands than the desktop layout — the responsive decision the
  // renderer relies on to keep labels legible on a narrow screen.
  assert(
    layer0Count(phone) <= PHONE_MAX_NODES_PER_LAYER + 1,
    `phone layer 0 must fold to its budget, got ${layer0Count(phone)}`,
  );
  assert(
    layer0Count(phone) < layer0Count(desktop),
    `phone (${layer0Count(phone)}) must keep fewer bands than desktop (${
      layer0Count(desktop)
    })`,
  );
  assert(phone.meta.withinBudget, "the phone diagram must fit the budget");
});
