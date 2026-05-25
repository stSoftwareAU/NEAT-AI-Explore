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
 * Pluralise a noun based on count. Pure helper so callers (and tests) can
 * share the same wording: "0 neurons", "1 neuron", "2 neurons".
 *
 * @param {number} count
 * @param {string} singular
 * @param {string} [plural=singular + "s"]
 * @returns {string}
 */
export function pluralise(count, singular, plural) {
  const p = plural ?? `${singular}s`;
  return `${count.toLocaleString()} ${count === 1 ? singular : p}`;
}

/**
 * Tooltip text for a layer dot: `Layer {i} ({type}) · {count} neuron(s)`.
 *
 * Pure so the legend/tooltip text is independently testable.
 *
 * @param {{ type?: string, count?: number } | null | undefined} layer
 * @param {number} index
 * @returns {string}
 */
export function formatDotTooltip(layer, index) {
  const type = layer?.type ?? "";
  const count = Number.isFinite(layer?.count) ? layer.count : 0;
  return `Layer ${index} (${type}) · ${pluralise(count, "neuron")}`;
}

/**
 * Tooltip text for an inter-layer link:
 * `{count} synapse(s) · Σw = {weightSum.toFixed(2)}`.
 *
 * Pure so the legend/tooltip text is independently testable. Sign is
 * preserved by `toFixed`; values to two decimal places per the spec.
 *
 * @param {{ count?: number, weightSum?: number } | null | undefined} edge
 * @returns {string}
 */
export function formatLinkTooltip(edge) {
  const count = Number.isFinite(edge?.count) ? edge.count : 0;
  const weightSum = Number.isFinite(edge?.weightSum) ? edge.weightSum : 0;
  return `${pluralise(count, "synapse")} · Σw = ${weightSum.toFixed(2)}`;
}

/**
 * Build the inline legend HTML used below the topology diagram (and reused
 * in the pop-out modal — see #241). DOM-free so the same markup ships from
 * both call sites.
 *
 * The three rows match the visual encodings introduced in #239:
 *   - dot size  → neurons per layer (log)
 *   - link thickness → synapses between layers (log)
 *   - link colour → sum of weights (red negative → blue positive)
 *
 * @returns {string}
 */
export function topologyLegendHtml() {
  const dot = `<svg class="topoLegendSwatch" viewBox="0 0 24 24" ` +
    `width="24" height="24" aria-hidden="true" focusable="false">` +
    `<circle cx="12" cy="12" r="6" fill="var(--accent)" />` +
    `</svg>`;
  const line = `<svg class="topoLegendSwatch" viewBox="0 0 32 24" ` +
    `width="32" height="24" aria-hidden="true" focusable="false">` +
    `<line x1="2" y1="8" x2="30" y2="8" stroke="var(--muted)" ` +
    `stroke-width="1" />` +
    `<line x1="2" y1="17" x2="30" y2="17" stroke="var(--muted)" ` +
    `stroke-width="5" />` +
    `</svg>`;
  const gradient = `<span class="topoLegendSwatch topoLegendGradient" ` +
    `aria-hidden="true"></span>`;
  return `<dl class="topoLegend" aria-label="Topology diagram legend">` +
    `<div class="topoLegendRow">${dot}` +
    `<dt>Dot size</dt><dd>neurons per layer (log)</dd></div>` +
    `<div class="topoLegendRow">${line}` +
    `<dt>Link thickness</dt><dd>synapses between layers (log)</dd></div>` +
    `<div class="topoLegendRow">${gradient}` +
    `<dt>Link colour</dt><dd>sum of weights ` +
    `(red negative → blue positive)</dd></div>` +
    `</dl>`;
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

    // Tooltip applies to both the line/arc and the arrow-head polygon so
    // hovering anywhere on the link surfaces the same info (Issue #240).
    const linkTitle = escapeXml(formatLinkTooltip(e));

    if (isSkip) {
      // Arc above for skip connections — anchored to the per-layer radii so
      // the arc emerges cleanly from the top of each dot.
      const arcH = 14 + span * 10;
      const midX = (x1 + x2) / 2;
      const cpY = cy - maxR - arcH;
      parts.push(
        `<g class="topoLink topoLinkSkip">` +
          `<title>${linkTitle}</title>` +
          `<path d="M${x1},${cy - fromR} Q${midX},${cpY} ${x2},${cy - toR}" ` +
          `fill="none" stroke="${colour}" stroke-width="${strokeW}" ` +
          `stroke-opacity="${opacity}" stroke-dasharray="4 3" />` +
          `<polygon points="${x2},${cy - toR} ${x2 - 4},${cy - toR - 7} ${
            x2 + 4
          },${cy - toR - 7}" ` +
          `fill="${colour}" opacity="${opacity}" />` +
          `</g>`,
      );
    } else {
      parts.push(
        `<g class="topoLink topoLinkAdjacent">` +
          `<title>${linkTitle}</title>` +
          `<line x1="${x1 + fromR}" y1="${cy}" x2="${x2 - toR}" y2="${cy}" ` +
          `stroke="${colour}" stroke-width="${strokeW}" ` +
          `stroke-opacity="${opacity}" />` +
          `<polygon points="${x2 - toR},${cy} ${x2 - toR - 7},${cy - 4} ${
            x2 - toR - 7
          },${cy + 4}" ` +
          `fill="${colour}" opacity="${opacity}" />` +
          `</g>`,
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
    // Richer hover tooltip (Issue #240): includes layer index, type, and
    // pluralised neuron count.
    const title = formatDotTooltip(layer, i);

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
