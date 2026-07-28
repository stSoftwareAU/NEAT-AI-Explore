/**
 * Sankey geometry regression tests (Issue #552).
 *
 * The phone view rendered garbled: hub bands ballooned into blobs, spilled past
 * the top of the canvas and did not line up with the node bars. Two faults in
 * `computeSankeyGeometry` caused it:
 *
 *   1. per-band and per-node thicknesses are floored at `layout.minBand`, but
 *      the shared vertical scale and the node heights were computed from raw
 *      contribution values alone — so a hub node whose bands all hit the floor
 *      stacked a port span far taller than its own bar (and than the canvas); and
 *   2. bands were emitted as stroked cubic centre-lines, which balloon into
 *      lens/blob shapes once the stroke width approaches the column gap.
 *
 * These tests build the flow geometry directly so they exercise the exact
 * imbalance — a tiny multi-band hub next to a dominant path — that the real
 * snapshot produces but a folded synthetic snapshot hides.
 */

import { assert, assertEquals } from "./test_helpers.ts";

import { sankeyLayoutForWidth } from "../docs/shared/sankey_responsive.js";
import { computeSankeyGeometry } from "../docs/shared/sankey_layout.js";

// deno-lint-ignore no-explicit-any
type Any = any;

const PHONE_WIDTH = 390; // iPhone 14 CSS width.
const DESKTOP_WIDTH = 1440;

/**
 * A flow with a dominant path (B → HB → O carrying ~all of the Score) beside a
 * tiny hub H that collects `hubBands` genuinely small inbound bands. The
 * dominant path sets a small vertical scale, so every hub band falls to the
 * `minBand` floor and their stacked span dwarfs the hub's own bar — the shape
 * that ballooned and overflowed before the fix.
 */
function hubFlow(hubBands: number) {
  const nodes: Any[] = [
    { id: "B", label: "Big source", layer: 0, value: 100 },
    { id: "HB", label: "Big hidden", layer: 1, value: 100 },
    { id: "H", label: "Tiny hub", layer: 1, value: 0.001 * hubBands },
    { id: "O", label: "Score", layer: 2, value: 100 + 0.001 * hubBands },
  ];
  const links: Any[] = [
    { id: "B=>HB", source: "B", target: "HB", value: 100, weight: 1 },
    { id: "HB=>O", source: "HB", target: "O", value: 100, weight: 1 },
    {
      id: "H=>O",
      source: "H",
      target: "O",
      value: 0.001 * hubBands,
      weight: 1,
    },
  ];
  for (let i = 0; i < hubBands; i++) {
    nodes.push({ id: `s${i}`, label: `Tiny ${i}`, layer: 0, value: 0.001 });
    links.push({
      id: `s${i}=>H`,
      source: `s${i}`,
      target: "H",
      value: 0.001,
      weight: 1,
    });
  }
  return { nodes, links, totalScore: 100 + 0.001 * hubBands };
}

Deno.test("no node's bar or bands overflow the canvas", () => {
  for (const width of [PHONE_WIDTH, DESKTOP_WIDTH]) {
    const layout = sankeyLayoutForWidth(width);
    const geometry = computeSankeyGeometry(hubFlow(5), layout);
    assert(geometry.nodes.length > 0, "the fixture must render some nodes");
    for (const node of geometry.nodes) {
      assert(
        node.y >= -1e-6,
        `node ${node.id} spills above the canvas (y=${node.y}) at ${width}px`,
      );
      assert(
        node.y + node.h <= geometry.viewHeight + 1e-6,
        `node ${node.id} overruns the view height at ${width}px`,
      );
    }
  }
});

Deno.test("every band fits inside both node bars it connects", () => {
  for (const width of [PHONE_WIDTH, DESKTOP_WIDTH]) {
    const layout = sankeyLayoutForWidth(width);
    const geometry = computeSankeyGeometry(hubFlow(5), layout);
    const rectById = new Map(geometry.nodes.map((n: Any) => [n.id, n]));

    for (const link of geometry.links) {
      const src = rectById.get((link.link as Any).source) as Any;
      const tgt = rectById.get((link.link as Any).target) as Any;
      assert(src && tgt, `band ${link.id} must connect two placed nodes`);
      const half = link.thickness / 2;
      // The band's source/target edges must sit within the node bar's extent —
      // this is the "bands line up with the node bars" acceptance criterion.
      assert(
        link.sy - half >= src.y - 1e-6 &&
          link.sy + half <= src.y + src.h + 1e-6,
        `band ${link.id} overflows its source bar at ${width}px`,
      );
      assert(
        link.ty - half >= tgt.y - 1e-6 &&
          link.ty + half <= tgt.y + tgt.h + 1e-6,
        `band ${link.id} overflows its target bar at ${width}px`,
      );
    }
  }
});

Deno.test("the sum of a node's inbound bands never exceeds its bar height", () => {
  const layout = sankeyLayoutForWidth(PHONE_WIDTH);
  const geometry = computeSankeyGeometry(hubFlow(5), layout);
  const rectById = new Map(geometry.nodes.map((n: Any) => [n.id, n]));

  const inboundSpan = new Map<string, number>();
  for (const link of geometry.links) {
    const target = (link.link as Any).target;
    inboundSpan.set(target, (inboundSpan.get(target) ?? 0) + link.thickness);
  }
  for (const [id, span] of inboundSpan) {
    const rect = rectById.get(id) as Any;
    assert(
      span <= rect.h + 1e-6,
      `node ${id} inbound bands span ${span} but the bar is only ${rect.h} tall`,
    );
  }
});

Deno.test("bands are filled ribbon polygons, not stroked centre-lines", () => {
  const layout = sankeyLayoutForWidth(PHONE_WIDTH);
  const geometry = computeSankeyGeometry(hubFlow(5), layout);
  assert(geometry.links.length > 0, "the fixture must render some bands");
  for (const link of geometry.links) {
    // A filled ribbon is a closed shape (two edges + a close command). A
    // stroked centre-line is a single open cubic, which balloons under a wide
    // stroke — the very fault we are fixing.
    assert(
      link.path.trim().endsWith("Z"),
      `band ${link.id} must be a closed ribbon polygon, got: ${link.path}`,
    );
    // Two cubic edges (top and bottom) make the ribbon.
    const cubics = (link.path.match(/C/g) ?? []).length;
    assertEquals(cubics, 2, `band ${link.id} must have a top and bottom edge`);
  }
});

Deno.test("bands still carry a positive thickness and endpoints", () => {
  const layout = sankeyLayoutForWidth(PHONE_WIDTH);
  const geometry = computeSankeyGeometry(hubFlow(5), layout);
  for (const link of geometry.links) {
    assert(
      link.thickness >= layout.minBand - 1e-9,
      `band ${link.id} below floor`,
    );
    for (const k of ["sx", "sy", "tx", "ty"] as const) {
      assert(Number.isFinite(link[k]), `band ${link.id} has a non-finite ${k}`);
    }
  }
});
