/**
 * Tests for the topology diagram renderer (issue #239).
 *
 * Asserts that `topologyToSvgString` honours the visual encodings the
 * acceptance criteria call out: log-scaled dot radii, log-scaled link
 * thicknesses, diverging weight-sum link colour, preserved skip-arc dash
 * pattern, and viewBox that tracks the largest dot.
 */

import {
  formatDotTooltip,
  formatLinkTooltip,
  pluralise,
  TOPO_MAX_LINK_W,
  TOPO_MAX_NODE_R,
  TOPO_MIN_LINK_W,
  TOPO_MIN_NODE_R,
  topologyLegendHtml,
  topologyToSvgString,
} from "../docs/shared/topology_diagram.js";
import { assert, assertEquals } from "./test_helpers.ts";
import { parseHtml } from "./dom_helpers.ts";

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

/**
 * Extract every (x, y) coordinate pair from an SVG path `d` string.
 *
 * Command letters (M/L/Q/C/...) are ignored, so this tolerates the arc being
 * drawn as a quadratic, cubic, or polyline — we only care where the points
 * land, not which command places them.
 */
function pathCoords(d: string): { x: number; y: number }[] {
  const nums = (d.match(/-?[\d.]+/g) ?? []).map(Number);
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    out.push({ x: nums[i], y: nums[i + 1] });
  }
  return out;
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
  // Skip arc must clear the top of the canvas (no clipping). Pull the arc's
  // path via the DOM and assert every anchor/control point stays within the
  // vertical viewBox bounds. By the convex-hull property of Bézier/polyline
  // curves, a curve never leaves the box bounding its defining points — so
  // this guarantees the rendered arc itself stays on-canvas regardless of
  // whether it is drawn as a quadratic Q, a cubic C, or a polyline.
  const arc = parseHtml(svg).querySelector(".topoLinkSkip path");
  assert(arc, "expected a skip-arc <path>");
  const d = arc!.getAttribute("d") ?? "";
  const ys = pathCoords(d).map((p) => p.y);
  assert(ys.length > 0, `expected coordinates in path d="${d}"`);
  for (const y of ys) {
    assert(
      y >= 0 && y <= h,
      `skip-arc point y=${y} falls outside the viewBox [0, ${h}]`,
    );
  }

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

// ---------------------------------------------------------------------------
// Issue #240 — tooltip helper + inline legend.
// ---------------------------------------------------------------------------

Deno.test("pluralise: 0/1/N grammar matches spec", () => {
  assertEquals(pluralise(0, "neuron"), "0 neurons");
  assertEquals(pluralise(1, "neuron"), "1 neuron");
  assertEquals(pluralise(2, "neuron"), "2 neurons");
  assertEquals(pluralise(0, "synapse"), "0 synapses");
  assertEquals(pluralise(1, "synapse"), "1 synapse");
  assertEquals(pluralise(2, "synapse"), "2 synapses");
});

Deno.test("formatDotTooltip: layer index, type, and pluralised count", () => {
  assertEquals(
    formatDotTooltip({ type: "input", count: 1 }, 0),
    "Layer 0 (input) · 1 neuron",
  );
  assertEquals(
    formatDotTooltip({ type: "hidden", count: 16 }, 2),
    "Layer 2 (hidden) · 16 neurons",
  );
  assertEquals(
    formatDotTooltip({ type: "output", count: 0 }, 5),
    "Layer 5 (output) · 0 neurons",
  );
});

Deno.test("formatLinkTooltip: pluralised synapse count and Σw two-decimal", () => {
  assertEquals(
    formatLinkTooltip({ count: 1, weightSum: 0.5 }),
    "1 synapse · Σw = 0.50",
  );
  assertEquals(
    formatLinkTooltip({ count: 200, weightSum: -1.234 }),
    "200 synapses · Σw = -1.23",
  );
  assertEquals(
    formatLinkTooltip({ count: 0, weightSum: 0 }),
    "0 synapses · Σw = 0.00",
  );
});

Deno.test("topologyToSvgString: dot title surfaces layer index and count", () => {
  const topo = fixture(
    [
      { type: "input", count: 1 },
      { type: "hidden", count: 7 },
      { type: "output", count: 1 },
    ],
    [
      { from: 0, to: 1, count: 1, weightSum: 0 },
      { from: 1, to: 2, count: 1, weightSum: 0 },
    ],
  );
  const { svg } = topologyToSvgString(topo);
  const titles: string[] = [];
  const re = /<g class="topoNode"[^>]*>\s*<title>([^<]+)<\/title>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg)) !== null) titles.push(m[1]);
  assertEquals(titles.length, 3);
  assertEquals(titles[0], "Layer 0 (input) · 1 neuron");
  assertEquals(titles[1], "Layer 1 (hidden) · 7 neurons");
  assertEquals(titles[2], "Layer 2 (output) · 1 neuron");
});

Deno.test("topologyToSvgString: link title surfaces synapse count and Σw", () => {
  const topo = fixture(
    [
      { type: "input", count: 2 },
      { type: "hidden", count: 2 },
      { type: "output", count: 2 },
    ],
    [
      { from: 0, to: 1, count: 4, weightSum: 1.567 },
      { from: 1, to: 2, count: 1, weightSum: -0.5 },
      { from: 0, to: 2, count: 3, weightSum: 0.1 }, // skip
    ],
  );
  const { svg } = topologyToSvgString(topo);
  const titles: string[] = [];
  const re = /<g class="topoLink[^"]*"[^>]*>\s*<title>([^<]+)<\/title>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg)) !== null) titles.push(m[1]);
  assertEquals(titles.length, 3);
  assertEquals(titles[0], "4 synapses · Σw = 1.57");
  assertEquals(titles[1], "1 synapse · Σw = -0.50");
  assertEquals(titles[2], "3 synapses · Σw = 0.10");
});

Deno.test("topologyToSvgString: arrow-head sits inside the link tooltip group", () => {
  // Observable contract: hovering the arrow surfaces the link tooltip. The
  // browser walks up from the hovered element to the nearest ancestor carrying
  // a <title>, so each link's <polygon> (arrow-head) and its <title> must live
  // inside the same .topoLink group. Asserted via the DOM so it tolerates
  // element reordering and self-closing-vs-paired tag syntax — only the
  // grouping relationship matters.
  const topo = fixture(
    [
      { type: "input", count: 1 },
      { type: "hidden", count: 2 },
      { type: "output", count: 1 },
    ],
    [
      { from: 0, to: 1, count: 2, weightSum: 1.0 },
      { from: 1, to: 2, count: 1, weightSum: -0.5 },
      { from: 0, to: 2, count: 3, weightSum: 0.2 }, // skip arc
    ],
  );
  const { svg } = topologyToSvgString(topo);
  const groups = parseHtml(svg).querySelectorAll(".topoLink");
  assert(groups.length > 0, "expected at least one .topoLink group");
  for (const group of groups) {
    const cls = group.getAttribute("class");
    const title = group.querySelector("title");
    const polygon = group.querySelector("polygon");
    assert(title, `link group "${cls}" missing a <title>`);
    assert(polygon, `link group "${cls}" missing a <polygon> arrow-head`);
    // Both are descendants of the same group — so hovering the arrow surfaces
    // this group's tooltip.
    assertEquals(title!.parentElement, group);
    assertEquals(polygon!.parentElement, group);
  }
});

Deno.test("topologyLegendHtml: three labelled rows with swatches", () => {
  const html = topologyLegendHtml();
  // Top-level container with the documented class.
  assert(
    /<dl class="topoLegend"/.test(html),
    'legend should be a <dl class="topoLegend">',
  );
  // Exactly three rows.
  const rows = html.match(/<div class="topoLegendRow">/g) ?? [];
  assertEquals(rows.length, 3);
  // The three labels described in the spec.
  assert(/<dt>Dot size<\/dt>/.test(html), "missing dot-size row label");
  assert(
    /<dt>Link thickness<\/dt>/.test(html),
    "missing link-thickness row label",
  );
  assert(/<dt>Link colour<\/dt>/.test(html), "missing link-colour row label");
  // Visible swatches — circle, thin/thick lines, gradient swatch.
  assert(/<circle /.test(html), "dot-size swatch should contain a <circle>");
  const lineCount = (html.match(/<line /g) ?? []).length;
  assert(
    lineCount >= 2,
    `link-thickness swatch should contain at least two <line>s (got ${lineCount})`,
  );
  assert(
    /topoLegendGradient/.test(html),
    "link-colour swatch should use the gradient class",
  );
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
