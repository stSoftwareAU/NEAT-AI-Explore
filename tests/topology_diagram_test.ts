/**
 * Tests for the topology diagram renderer (issue #239).
 *
 * Asserts that `topologyToSvgString` honours the visual encodings the
 * acceptance criteria call out: log-scaled dot radii, log-scaled link
 * thicknesses, diverging weight-sum link colour, preserved skip-arc dash
 * pattern, and viewBox that tracks the largest dot.
 */

import {
  TOPO_MAX_LINK_W,
  TOPO_MAX_NODE_R,
  TOPO_MIN_LINK_W,
  TOPO_MIN_NODE_R,
  topologyToSvgString,
} from "../docs/shared/topology_diagram.js";
import { assert, assertEquals } from "./test_helpers.ts";

// ---------------------------------------------------------------------------
// Small markup helpers.
// ---------------------------------------------------------------------------

/** Pull every layer circle's r attribute in document order. */
function nodeRadii(svg: string): number[] {
  // Each topoNode group contains exactly one circle; capture them positionally.
  const out: number[] = [];
  const re = /<g class="topoNode"[^>]*>[\s\S]*?<circle[^>]*r="([\d.]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg)) !== null) {
    out.push(Number(m[1]));
  }
  return out;
}

/** Pull every adjacent-link stroke-width in document order. */
function lineStrokeWidths(svg: string): number[] {
  const out: number[] = [];
  const re = /<line[^>]*stroke-width="([\d.]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg)) !== null) {
    out.push(Number(m[1]));
  }
  return out;
}

/** Pull every adjacent-link stroke colour in document order. */
function lineStrokeColours(svg: string): string[] {
  const out: string[] = [];
  const re = /<line[^>]*stroke="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg)) !== null) {
    out.push(m[1]);
  }
  return out;
}

/** Pull the viewBox h component. */
function viewBoxHeight(svg: string): number {
  const m = svg.match(/viewBox="0 0 [\d.]+ ([\d.]+)"/);
  assert(m, "expected a viewBox attribute");
  return Number(m![1]);
}

/** Parse `rgb(r, g, b)` into a triple. */
function parseRgb(s: string): [number, number, number] {
  const m = s.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  assert(m, `expected rgb(...) colour, got ${s}`);
  return [Number(m![1]), Number(m![2]), Number(m![3])];
}

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

function fixture(
  layers: { type: string; count: number; uuids?: string[] }[],
  edges: { from: number; to: number; count: number; weightSum: number }[],
) {
  return {
    layers: layers.map((l) => ({ ...l, uuids: l.uuids ?? [] })),
    edges,
  };
}

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

Deno.test("topologyToSvgString: dot radius is log-scaled by neuron count", () => {
  // Layers of size {3, 16, 64, 2} — acceptance criterion.
  const topo = fixture(
    [
      { type: "input", count: 3 },
      { type: "hidden", count: 16 },
      { type: "hidden", count: 64 },
      { type: "output", count: 2 },
    ],
    [
      { from: 0, to: 1, count: 1, weightSum: 0 },
      { from: 1, to: 2, count: 1, weightSum: 0 },
      { from: 2, to: 3, count: 1, weightSum: 0 },
    ],
  );

  const { svg } = topologyToSvgString(topo);
  const radii = nodeRadii(svg);
  assertEquals(radii.length, 4);
  const [r3, r16, r64, r2] = radii;

  assert(
    r64 > r16,
    `expected 64-neuron r (${r64}) > 16-neuron r (${r16})`,
  );
  assert(
    r16 > r3,
    `expected 16-neuron r (${r16}) > 3-neuron r (${r3})`,
  );
  assert(r3 > r2, `expected 3-neuron r (${r3}) > 2-neuron r (${r2})`);
  // All radii sit within the documented bounds.
  for (const r of radii) {
    assert(
      r >= TOPO_MIN_NODE_R && r <= TOPO_MAX_NODE_R,
      `radius ${r} out of [${TOPO_MIN_NODE_R}, ${TOPO_MAX_NODE_R}]`,
    );
  }
});

Deno.test("topologyToSvgString: link thickness is log-scaled by synapse count", () => {
  // Edges with counts {5, 200} — acceptance criterion.
  const topo = fixture(
    [
      { type: "input", count: 4 },
      { type: "hidden", count: 4 },
      { type: "output", count: 4 },
    ],
    [
      { from: 0, to: 1, count: 5, weightSum: 0 },
      { from: 1, to: 2, count: 200, weightSum: 0 },
    ],
  );

  const { svg } = topologyToSvgString(topo);
  const widths = lineStrokeWidths(svg);
  assertEquals(widths.length, 2);
  const [w5, w200] = widths;

  assert(
    w200 > w5,
    `expected 200-count stroke-width (${w200}) > 5-count (${w5})`,
  );
  for (const w of widths) {
    assert(
      w >= TOPO_MIN_LINK_W && w <= TOPO_MAX_LINK_W,
      `stroke-width ${w} out of [${TOPO_MIN_LINK_W}, ${TOPO_MAX_LINK_W}]`,
    );
  }
});

Deno.test("topologyToSvgString: link colour diverges with weightSum sign", () => {
  // Two adjacent links — one positive, one negative — same magnitude.
  const topo = fixture(
    [
      { type: "input", count: 2 },
      { type: "hidden", count: 2 },
      { type: "output", count: 2 },
    ],
    [
      { from: 0, to: 1, count: 4, weightSum: 1.5 },
      { from: 1, to: 2, count: 4, weightSum: -1.5 },
    ],
  );

  const { svg } = topologyToSvgString(topo);
  const colours = lineStrokeColours(svg);
  assertEquals(colours.length, 2);

  const [pos, neg] = colours.map(parseRgb);
  // Positive weightSum → blue-leaning (B > R).
  assert(
    pos[2] > pos[0],
    `expected blue-leaning rgb for +weightSum, got rgb(${pos.join(", ")})`,
  );
  // Negative weightSum → red-leaning (R > B).
  assert(
    neg[0] > neg[2],
    `expected red-leaning rgb for -weightSum, got rgb(${neg.join(", ")})`,
  );
  // Symmetric magnitudes — channels swap, green matches.
  assertEquals(pos[1], neg[1]);
});

Deno.test("topologyToSvgString: skip arc preserves dash pattern", () => {
  const topo = fixture(
    [
      { type: "input", count: 2 },
      { type: "hidden", count: 2 },
      { type: "output", count: 2 },
    ],
    [
      { from: 0, to: 1, count: 1, weightSum: 0.1 },
      { from: 1, to: 2, count: 1, weightSum: 0.1 },
      { from: 0, to: 2, count: 1, weightSum: 0.1 }, // skip
    ],
  );

  const { svg } = topologyToSvgString(topo);
  assert(
    /<path[^>]*stroke-dasharray="4 3"/.test(svg),
    'skip arc must keep stroke-dasharray="4 3"',
  );
});

Deno.test("topologyToSvgString: viewBox accommodates largest dot and arc clearance", () => {
  // Multi-layer fixture with a long skip arc — the arc has to fit above the
  // dots, and the largest dot has to sit fully inside the viewBox.
  const topo = fixture(
    [
      { type: "input", count: 1 },
      { type: "hidden", count: 8 },
      { type: "hidden", count: 64 },
      { type: "output", count: 1 },
    ],
    [
      { from: 0, to: 1, count: 1, weightSum: 0 },
      { from: 1, to: 2, count: 1, weightSum: 0 },
      { from: 2, to: 3, count: 1, weightSum: 0 },
      { from: 0, to: 3, count: 1, weightSum: 0 }, // long skip arc
    ],
  );

  const { svg, maxNodeR } = topologyToSvgString(topo);
  const h = viewBoxHeight(svg);
  const radii = nodeRadii(svg);
  const biggest = Math.max(...radii);

  // Parse cy from the first circle (all circles share the same cy).
  const cyMatch = svg.match(/<circle[^>]*cy="([\d.]+)"/);
  assert(cyMatch, "expected a circle cy attribute");
  const cy = Number(cyMatch![1]);

  // The biggest dot's bottom edge plus its label band must fit in the viewBox.
  assert(
    cy + biggest + 16 <= h,
    `biggest dot bottom (${cy + biggest + 16}) exceeds viewBox height ${h}`,
  );
  // Skip arc must clear the top of the canvas (control point above y=0 means
  // the arc would have been clipped).
  const cpYMatch = svg.match(/<path[^>]*d="M[\d.]+,[\d.]+ Q[\d.]+,(-?[\d.]+)/);
  assert(cpYMatch, "expected a path control point");
  const cpY = Number(cpYMatch![1]);
  assert(cpY >= 0, `skip-arc control point cpY=${cpY} would clip at top`);

  // And the renderer reports the same biggest radius we just measured.
  assert(
    Math.abs(maxNodeR - biggest) < 1e-9,
    `maxNodeR (${maxNodeR}) should equal the largest measured radius (${biggest})`,
  );
});

Deno.test("topologyToSvgString: arrow heads match link colour (diverging)", () => {
  const topo = fixture(
    [
      { type: "input", count: 2 },
      { type: "output", count: 2 },
    ],
    [{ from: 0, to: 1, count: 4, weightSum: 2.0 }],
  );
  const { svg } = topologyToSvgString(topo);

  // Both the line stroke and the polygon (arrowhead) fill should be the
  // same diverging rgb value — not a CSS variable.
  const lineColour = svg.match(/<line[^>]*stroke="([^"]+)"/)?.[1];
  const polyColour = svg.match(/<polygon[^>]*fill="([^"]+)"/)?.[1];
  assert(lineColour, "line should have a stroke colour");
  assert(polyColour, "polygon should have a fill colour");
  assertEquals(lineColour, polyColour);
  assert(
    lineColour!.startsWith("rgb("),
    `expected concrete rgb(...) colour, got ${lineColour}`,
  );
});

Deno.test("topologyToSvgString: empty topology returns empty svg, zero counts", () => {
  const out = topologyToSvgString({ layers: [], edges: [] });
  assertEquals(out.svg, "");
  assertEquals(out.skipSynapseCount, 0);
  assertEquals(out.skipEdgeCount, 0);
  assertEquals(out.maxNodeR, 0);
});

Deno.test("topologyToSvgString: skip summary counts are exposed", () => {
  const topo = fixture(
    [
      { type: "input", count: 1 },
      { type: "hidden", count: 1 },
      { type: "hidden", count: 1 },
      { type: "output", count: 1 },
    ],
    [
      { from: 0, to: 1, count: 1, weightSum: 0 },
      { from: 1, to: 2, count: 1, weightSum: 0 },
      { from: 2, to: 3, count: 1, weightSum: 0 },
      { from: 0, to: 2, count: 4, weightSum: 0 }, // skip
      { from: 0, to: 3, count: 7, weightSum: 0 }, // skip
    ],
  );

  const out = topologyToSvgString(topo);
  assertEquals(out.skipEdgeCount, 2);
  assertEquals(out.skipSynapseCount, 11);
});

Deno.test("topologyToSvgString: layer nodes carry data-layer-index in order", () => {
  const topo = fixture(
    [
      { type: "input", count: 2, uuids: ["i-0", "i-1"] },
      { type: "output", count: 1, uuids: ["o-0"] },
    ],
    [{ from: 0, to: 1, count: 2, weightSum: 0 }],
  );
  const { svg } = topologyToSvgString(topo);
  const indices: number[] = [];
  const re = /data-layer-index="(\d+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg)) !== null) indices.push(Number(m[1]));
  assertEquals(indices.length, 2);
  assertEquals(indices[0], 0);
  assertEquals(indices[1], 1);
});
