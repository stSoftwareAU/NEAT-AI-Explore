/**
 * Pure renderer for the creature overview topology diagram (issue #239).
 *
 * Produces an SVG string from a {@link Topology} value, scaling dot radii
 * and link thicknesses on a natural-log scale and colouring links via the
 * diverging weight-sum colour map. DOM-free, so it can be imported by the
 * app and exercised by Deno tests against the raw markup.
 *
 * @module
 */

import { divergingWeightSumColourCss } from "./colour_maps.js";
import { logScalePixels } from "./scale.js";

/**
 * Min/max pixel sizes for the visual encodings.
 *
 * Exposed so tests can assert against the same bounds the renderer uses.
 */
export const TOPO_MIN_NODE_R = 10;
export const TOPO_MAX_NODE_R = 32;
export const TOPO_MIN_LINK_W = 1;
export const TOPO_MAX_LINK_W = 6;

/** Per-link opacity — skip arcs sit slightly above adjacent links. */
const ADJACENT_LINK_OPACITY = 0.7;
const SKIP_LINK_OPACITY = 0.9;

const TYPE_COLOUR = {
  input: "var(--positive)",
  hidden: "var(--accent)",
  output: "var(--highlight)",
};

/** Minimal XML escape for text rendered inside `<title>`/`<text>` elements. */
function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * @typedef {import("./creature_overview.js").Topology} Topology
 *
 * @typedef {{
 *   svg: string,
 *   skipSynapseCount: number,
 *   skipEdgeCount: number,
 *   maxNodeR: number,
 * }} TopologySvg
 */

/**
 * Build the topology diagram SVG string and a few derived counts used by
 * the caller to render the skip-connection summary line.
 *
 * @param {Topology | null | undefined} topology
 * @returns {TopologySvg}
 */
export function topologyToSvgString(topology) {
  const layers = topology?.layers ?? [];
  const edges = topology?.edges ?? [];
  const n = layers.length;

  if (n === 0) {
    return { svg: "", skipSynapseCount: 0, skipEdgeCount: 0, maxNodeR: 0 };
  }

  // --- Pre-scan: find the scaling ceilings. ----------------------------------
  let maxNeuronCount = 0;
  for (const l of layers) {
    const c = Number.isFinite(l?.count) ? l.count : 0;
    if (c > maxNeuronCount) maxNeuronCount = c;
  }

  let maxSynapseCount = 0;
  let maxAbsWeightSum = 0;
  let maxSpan = 0;
  for (const e of edges) {
    const c = Number.isFinite(e?.count) ? e.count : 0;
    if (c > maxSynapseCount) maxSynapseCount = c;
    const aw = Math.abs(Number.isFinite(e?.weightSum) ? e.weightSum : 0);
    if (aw > maxAbsWeightSum) maxAbsWeightSum = aw;
    const span = Math.abs((e?.to ?? 0) - (e?.from ?? 0));
    if (span > 1 && span > maxSpan) maxSpan = span;
  }

  // Per-layer radius (log scale → MIN_R..MAX_R).
  const radii = layers.map((l) =>
    logScalePixels(
      l?.count ?? 0,
      maxNeuronCount,
      TOPO_MIN_NODE_R,
      TOPO_MAX_NODE_R,
    )
  );
  let maxR = TOPO_MIN_NODE_R;
  for (const r of radii) if (r > maxR) maxR = r;

  // --- Layout — recomputed to track the variable max radius. -----------------
  // Spacing has to outgrow the biggest dot so dots never touch.
  const nodeSpacing = Math.max(72, 2 * maxR + 32);
  const padX = maxR + 8;
  const arcClearance = 22;
  const topPad = maxSpan > 0 ? arcClearance + maxSpan * 10 : 8;
  const cy = topPad + maxR + 4;
  const svgH = cy + maxR + 24;
  const svgW = padX * 2 + (n - 1) * nodeSpacing;
  const cx = (i) => padX + i * nodeSpacing;

  // --- Build SVG -------------------------------------------------------------
  const parts = [];
  parts.push(
    `<svg class="topoSvg" viewBox="0 0 ${svgW} ${svgH}" ` +
      `width="100%" style="max-width:${svgW}px" ` +
      `xmlns="http://www.w3.org/2000/svg">`,
  );

  // Edges first so nodes sit on top.
  for (const e of edges) {
    const fromIdx = e?.from ?? 0;
    const toIdx = e?.to ?? 0;
    if (fromIdx < 0 || fromIdx >= n || toIdx < 0 || toIdx >= n) continue;

    const x1 = cx(fromIdx);
    const x2 = cx(toIdx);
    const fromR = radii[fromIdx] ?? TOPO_MIN_NODE_R;
    const toR = radii[toIdx] ?? TOPO_MIN_NODE_R;
    const span = Math.abs(toIdx - fromIdx);
    const isSkip = span > 1;

    const strokeW = logScalePixels(
      e?.count ?? 0,
      maxSynapseCount,
      TOPO_MIN_LINK_W,
      TOPO_MAX_LINK_W,
    );
    const opacity = isSkip ? SKIP_LINK_OPACITY : ADJACENT_LINK_OPACITY;
    const colour = divergingWeightSumColourCss(
      e?.weightSum ?? 0,
      maxAbsWeightSum,
    );

    if (isSkip) {
      // Arc above for skip connections — anchored to the per-layer radii so
      // the arc emerges cleanly from the top of each dot.
      const arcH = 14 + span * 10;
      const midX = (x1 + x2) / 2;
      const cpY = cy - maxR - arcH;
      parts.push(
        `<path d="M${x1},${cy - fromR} Q${midX},${cpY} ${x2},${cy - toR}" ` +
          `fill="none" stroke="${colour}" stroke-width="${strokeW}" ` +
          `stroke-opacity="${opacity}" stroke-dasharray="4 3" />`,
      );
      parts.push(
        `<polygon points="${x2},${cy - toR} ${x2 - 4},${cy - toR - 7} ${
          x2 + 4
        },${cy - toR - 7}" ` +
          `fill="${colour}" opacity="${opacity}" />`,
      );
    } else {
      parts.push(
        `<line x1="${x1 + fromR}" y1="${cy}" x2="${x2 - toR}" y2="${cy}" ` +
          `stroke="${colour}" stroke-width="${strokeW}" ` +
          `stroke-opacity="${opacity}" />`,
      );
      parts.push(
        `<polygon points="${x2 - toR},${cy} ${x2 - toR - 7},${cy - 4} ${
          x2 - toR - 7
        },${cy + 4}" ` +
          `fill="${colour}" opacity="${opacity}" />`,
      );
    }
  }

  // Layer nodes.
  for (let i = 0; i < n; i++) {
    const layer = layers[i];
    const x = cx(i);
    const r = radii[i];
    const fill = TYPE_COLOUR[layer?.type] ?? "var(--muted)";
    const label = layer?.type === "hidden" ? `hidden ${i}` : layer?.type ?? "";
    const title = `${layer?.count ?? 0} ${layer?.type ?? ""} neuron${
      (layer?.count ?? 0) !== 1 ? "s" : ""
    }`;

    parts.push(
      `<g class="topoNode" data-layer-index="${i}" style="cursor:pointer">` +
        `<title>${escapeXml(title)}</title>` +
        `<circle cx="${x}" cy="${cy}" r="${r}" fill="${fill}" />` +
        `<text x="${x}" y="${
          cy + 5
        }" text-anchor="middle" fill="#fff" font-size="13" font-weight="700">` +
        `${layer?.count ?? 0}</text>` +
        `<text x="${x}" y="${
          cy + r + 16
        }" text-anchor="middle" fill="var(--muted)" font-size="11">` +
        `${escapeXml(label)}</text>` +
        `</g>`,
    );
  }

  parts.push("</svg>");

  // Summary stats consumed by the caller.
  let skipSynapseCount = 0;
  let skipEdgeCount = 0;
  for (const e of edges) {
    if (Math.abs((e?.to ?? 0) - (e?.from ?? 0)) > 1) {
      skipEdgeCount += 1;
      skipSynapseCount += Number.isFinite(e?.count) ? e.count : 0;
    }
  }

  return {
    svg: parts.join(""),
    skipSynapseCount,
    skipEdgeCount,
    maxNodeR: maxR,
  };
}
