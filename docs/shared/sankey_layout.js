/**
 * Sankey geometry — DOM-free (Issue #540).
 *
 * `docs/sankey/sankey.js` used to compute node rectangles, band thicknesses and
 * label visibility inline while building SVG, so the layout decisions the
 * renderer makes could not be asserted in CI. This module is that geometry,
 * lifted out and parameterised by the responsive constants in
 * `sankey_responsive.js`, so a regression that reverts the phone layout to the
 * desktop canvas fails before merge.
 *
 * Node band height and link band thickness share one vertical scale, so a
 * node's inbound bands visually sum to its height — the diagram reads as
 * conserved flow, which is the whole point of the Score-composition view.
 */

import { bandWidth } from "./sankey_flow.js";
import { sankeyViewWidth } from "./sankey_responsive.js";

/**
 * Truncate a label so long observation names do not overrun the column gap.
 *
 * @param {unknown} text
 * @param {number} max — maximum rendered length, including the ellipsis.
 * @returns {string}
 */
export function truncateLabel(text, max) {
  const s = String(text ?? "");
  const limit = Math.max(1, Math.floor(Number(max) || 1));
  return s.length > limit ? `${s.slice(0, limit - 1)}…` : s;
}

/**
 * @typedef {object} SankeyNodeGeometry
 * @property {string} id
 * @property {object} node — the flow node this rectangle draws.
 * @property {number} x
 * @property {number} y
 * @property {number} h — rectangle height, floored at `layout.minBand`.
 * @property {number} width — rectangle width (`layout.nodeWidth`).
 * @property {number} colIndex
 * @property {boolean} showLabel — false when the band is too thin to label.
 * @property {number} labelX
 * @property {number} labelY
 * @property {"start"|"end"} labelAnchor
 * @property {string} labelText — already truncated for the live layout.
 */

/**
 * @typedef {object} SankeyLinkGeometry
 * @property {string} id
 * @property {object} link — the flow band this path draws.
 * @property {number} sx
 * @property {number} sy
 * @property {number} tx
 * @property {number} ty
 * @property {number} thickness
 * @property {string} path — the SVG `d` for a closed, filled ribbon polygon.
 */

/**
 * Lay out a Sankey flow for a given set of responsive constants.
 *
 * @param {{ nodes: Array<object>, links: Array<object> }} flow
 * @param {import("./sankey_responsive.js").SankeyLayout} layout
 * @returns {{
 *   viewWidth: number,
 *   viewHeight: number,
 *   columnCount: number,
 *   vScale: number,
 *   nodes: SankeyNodeGeometry[],
 *   links: SankeyLinkGeometry[],
 * }}
 */
export function computeSankeyGeometry(flow, layout) {
  if (!flow || !Array.isArray(flow.nodes) || !Array.isArray(flow.links)) {
    throw new Error(
      "computeSankeyGeometry requires a flow with nodes and links",
    );
  }
  if (!layout || !Number.isFinite(layout.viewHeight)) {
    throw new Error(
      "computeSankeyGeometry requires responsive layout constants",
    );
  }

  const visible = flow.nodes.filter((n) => n.value > 0);

  // Group visible nodes into columns by layer (dropping empty layers).
  const byLayer = new Map();
  for (const node of visible) {
    if (!byLayer.has(node.layer)) byLayer.set(node.layer, []);
    byLayer.get(node.layer).push(node);
  }
  const columns = Array.from(byLayer.keys())
    .sort((a, b) => a - b)
    .map((layer) =>
      byLayer.get(layer).slice().sort((a, b) =>
        b.value - a.value || (a.id < b.id ? -1 : 1)
      )
    );

  const viewWidth = sankeyViewWidth(layout, columns.length);
  const viewHeight = layout.viewHeight;
  if (columns.length === 0) {
    return {
      viewWidth,
      viewHeight,
      columnCount: 0,
      vScale: 1,
      nodes: [],
      links: [],
    };
  }

  // Per-node inbound / outbound band values, restricted to links whose both
  // endpoints are drawn. A node's height must cover its stacked ports, so the
  // geometry needs these before it can pick a vertical scale.
  const visibleIds = new Set(visible.map((n) => n.id));
  const inboundValues = new Map();
  const outboundValues = new Map();
  for (const link of flow.links) {
    if (!visibleIds.has(link.source) || !visibleIds.has(link.target)) continue;
    if (!outboundValues.has(link.source)) outboundValues.set(link.source, []);
    if (!inboundValues.has(link.target)) inboundValues.set(link.target, []);
    outboundValues.get(link.source).push(link.value);
    inboundValues.get(link.target).push(link.value);
  }

  // A port stack is the sum of its floored band thicknesses. Because each band
  // is floored at `minBand`, a hub's stacked ports can be far taller than its
  // raw value*scale — the overflow Issue #552 fixes.
  const portSpan = (values, scale) => {
    let sum = 0;
    for (const v of values) {
      sum += Math.max(bandWidth(v, scale), layout.minBand);
    }
    return sum;
  };
  const nodeHeight = (node, scale) =>
    Math.max(
      node.value * scale,
      layout.minBand,
      inboundValues.has(node.id)
        ? portSpan(inboundValues.get(node.id), scale)
        : 0,
      outboundValues.has(node.id)
        ? portSpan(outboundValues.get(node.id), scale)
        : 0,
    );
  const columnHeight = (col, scale) =>
    col.reduce((acc, n) => acc + nodeHeight(n, scale), 0) +
    (col.length - 1) * layout.nodeGap;

  // One vertical scale that fits the tallest column into the drawing area.
  const avail = viewHeight - 2 * layout.padY;
  let vScale = Infinity;
  for (const col of columns) {
    const sum = col.reduce((acc, n) => acc + n.value, 0);
    if (sum <= 0) continue;
    const usable = avail - (col.length - 1) * layout.nodeGap;
    vScale = Math.min(vScale, usable / sum);
  }
  if (!Number.isFinite(vScale) || vScale <= 0) vScale = 1;

  // The value-only scale above ignores the `minBand` floors, so a column whose
  // bands hit the floor still overflows `avail`. Shrink the scale until every
  // floored column fits — a bounded monotonic search, so it always converges.
  const fitsAll = (scale) =>
    columns.every((col) => columnHeight(col, scale) <= avail);
  if (!fitsAll(vScale)) {
    let lo = 0;
    let hi = vScale;
    for (let i = 0; i < 48; i++) {
      const mid = (lo + hi) / 2;
      if (fitsAll(mid)) lo = mid;
      else hi = mid;
    }
    // `hi` is the smallest positive scale reached when even a zero scale
    // over-subscribes the canvas (more floored bands than fit); it keeps bands
    // inside their bars while the pannable canvas absorbs the extra height.
    vScale = lo > 0 ? lo : hi;
  }
  if (!Number.isFinite(vScale) || vScale <= 0) vScale = 1;

  const innerW = viewWidth - 2 * layout.padX - layout.nodeWidth;

  // Position every node rectangle first — links need both endpoints placed.
  /** @type {Map<string, SankeyNodeGeometry & { outCursor: number, inCursor: number }>} */
  const rectById = new Map();
  columns.forEach((col, colIndex) => {
    const x = columns.length > 1
      ? layout.padX + (colIndex * innerW) / (columns.length - 1)
      : layout.padX + innerW / 2;
    const colHeight = columnHeight(col, vScale);
    // Centre the column, but never start above the top padding — a column that
    // still exceeds `avail` (over-subscribed) extends down into the pannable
    // canvas rather than spilling off the top of it.
    let cursor = Math.max(layout.padY, (viewHeight - colHeight) / 2);
    for (const node of col) {
      const h = nodeHeight(node, vScale);
      const outSpan = outboundValues.has(node.id)
        ? portSpan(outboundValues.get(node.id), vScale)
        : 0;
      const inSpan = inboundValues.has(node.id)
        ? portSpan(inboundValues.get(node.id), vScale)
        : 0;
      const isLeftColumn = x < layout.padX + innerW / 2;
      rectById.set(node.id, {
        id: node.id,
        node,
        x,
        y: cursor,
        h,
        width: layout.nodeWidth,
        colIndex,
        showLabel: h >= layout.labelMinHeight,
        labelX: isLeftColumn ? x + layout.nodeWidth + 6 : x - 6,
        labelY: cursor + h / 2,
        labelAnchor: isLeftColumn ? "start" : "end",
        labelText: truncateLabel(node.label || node.id, layout.labelMaxChars),
        // Centre each port stack within the bar so bands align with it and the
        // stack never runs past the rectangle (h ≥ inSpan and h ≥ outSpan).
        outCursor: cursor + (h - outSpan) / 2,
        inCursor: cursor + (h - inSpan) / 2,
      });
      cursor += h + layout.nodeGap;
    }
  });

  // Order each node's ports by the opposite endpoint's vertical position to
  // minimise band crossings.
  const linksBySource = new Map();
  const linksByTarget = new Map();
  for (const link of flow.links) {
    if (!rectById.has(link.source) || !rectById.has(link.target)) continue;
    if (!linksBySource.has(link.source)) linksBySource.set(link.source, []);
    if (!linksByTarget.has(link.target)) linksByTarget.set(link.target, []);
    linksBySource.get(link.source).push(link);
    linksByTarget.get(link.target).push(link);
  }
  const linkGeom = new Map();
  for (const [sourceId, list] of linksBySource) {
    const rect = rectById.get(sourceId);
    list.sort((a, b) =>
      (rectById.get(a.target)?.y ?? 0) - (rectById.get(b.target)?.y ?? 0)
    );
    for (const link of list) {
      const thickness = Math.max(
        bandWidth(link.value, vScale),
        layout.minBand,
      );
      const sy = rect.outCursor + thickness / 2;
      rect.outCursor += thickness;
      linkGeom.set(link.id, {
        thickness,
        sy,
        sx: rect.x + layout.nodeWidth,
      });
    }
  }
  for (const [targetId, list] of linksByTarget) {
    const rect = rectById.get(targetId);
    list.sort((a, b) =>
      (rectById.get(a.source)?.y ?? 0) - (rectById.get(b.source)?.y ?? 0)
    );
    for (const link of list) {
      const geom = linkGeom.get(link.id);
      if (!geom) continue;
      geom.ty = rect.inCursor + geom.thickness / 2;
      rect.inCursor += geom.thickness;
      geom.tx = rect.x;
    }
  }

  const links = [];
  for (const link of flow.links) {
    const geom = linkGeom.get(link.id);
    if (!geom || geom.tx === undefined) continue;
    const midX = (geom.sx + geom.tx) / 2;
    const half = geom.thickness / 2;
    const sTop = geom.sy - half;
    const sBot = geom.sy + half;
    const tTop = geom.ty - half;
    const tBot = geom.ty + half;
    // A filled ribbon polygon: a top edge and a bottom edge, each a cubic, then
    // closed. Unlike a stroked centre-line (whose round joins balloon into a
    // lens once the stroke nears the column gap), its thickness is exact at both
    // ends and it cannot balloon (Issue #552).
    links.push({
      id: link.id,
      link,
      sx: geom.sx,
      sy: geom.sy,
      tx: geom.tx,
      ty: geom.ty,
      thickness: geom.thickness,
      path:
        `M${geom.sx},${sTop} C${midX},${sTop} ${midX},${tTop} ${geom.tx},${tTop} ` +
        `L${geom.tx},${tBot} C${midX},${tBot} ${midX},${sBot} ${geom.sx},${sBot} Z`,
    });
  }

  const nodes = Array.from(rectById.values()).map((
    { outCursor: _out, inCursor: _in, ...rest },
  ) => rest);

  return {
    viewWidth,
    viewHeight,
    columnCount: columns.length,
    vScale,
    nodes,
    links,
  };
}
