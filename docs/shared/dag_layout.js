/**
 * Layered 2D DAG layout (Issue #525).
 *
 * Turns the aggregated layered graph model (`aggregated_graph_model.js`) into
 * a left-to-right diagram: observation families in the leftmost column, hidden
 * layers in topological order, the output in the rightmost column. Impact is
 * encoded twice — node radius/colour intensity for per-node impact, link width
 * for per-edge contribution — reusing the sizing bounds and colour maps the
 * creature-overview topology diagram already ships, so the two views read the
 * same way.
 *
 * DOM-free and deterministic: the same model always produces the same layout
 * and the same SVG string, so a view can memoise on it and tests can assert
 * against the markup.
 *
 * @example
 * const model = buildAggregatedGraphModel(snapshot);
 * const layout = computeDagLayout(model, { snapshot });
 * container.innerHTML = dagLayoutToSvgString(layout);
 *
 * @module
 */

import { logScalePixels } from "./scale.js";
import { divergingWeightSumColourCss } from "./colour_maps.js";
import {
  pluralise,
  TOPO_MAX_LINK_W,
  TOPO_MAX_NODE_R,
  TOPO_MIN_LINK_W,
  TOPO_MIN_NODE_R,
} from "./topology_diagram.js";
import {
  buildObservationTooltip,
  escapeHtml,
  extractTooltips,
} from "./ui_helpers.js";

/** Horizontal distance between column centres, in SVG units. */
export const DAG_COLUMN_GAP = 190;
/** Vertical distance between node centres within a column, in SVG units. */
export const DAG_ROW_GAP = 2 * TOPO_MAX_NODE_R + 26;
/** Padding around the diagram, in SVG units. */
export const DAG_PADDING = 28;
/** Height reserved above the first row for the column headings. */
export const DAG_HEADING_HEIGHT = 26;

/**
 * Most nodes drawn in one column before the weakest fold into a single
 * aggregate. At full scale a column can hold thousands of nodes, which reads
 * as a wall rather than a diagram.
 */
export const DAG_MAX_NODES_PER_COLUMN = 12;

/** Weakest and strongest colour intensity used for the per-node impact ramp. */
export const DAG_MIN_FILL_OPACITY = 0.35;
export const DAG_MAX_FILL_OPACITY = 1;

/** Longest node label rendered under a dot before it is elided. */
const MAX_LABEL_CHARS = 18;
/** Member summaries listed in an aggregate node's tooltip. */
const DEFAULT_TOOLTIP_MEMBERS = 3;

const COLOUR_BY_KIND = {
  family: "var(--positive)",
  neuron: "var(--accent)",
  collapsed: "var(--muted)",
};
const OUTPUT_COLOUR = "var(--highlight)";

/** Coerce to a finite number, falling back to 0. */
function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Radius in SVG units for a node's impact, clamped to the topology bounds. */
export function dagNodeRadius(impact, maxImpact) {
  return logScalePixels(
    Math.abs(finite(impact)),
    Math.abs(finite(maxImpact)),
    TOPO_MIN_NODE_R,
    TOPO_MAX_NODE_R,
  );
}

/** Stroke width for an edge's contribution, clamped to the topology bounds. */
export function dagLinkWidth(impact, maxImpact) {
  return logScalePixels(
    Math.abs(finite(impact)),
    Math.abs(finite(maxImpact)),
    TOPO_MIN_LINK_W,
    TOPO_MAX_LINK_W,
  );
}

/**
 * Colour intensity for a node's impact — the second half of the size/colour
 * encoding. Same log ramp as the radius, so a big dot is also a strong dot.
 */
export function dagNodeFillOpacity(impact, maxImpact) {
  return logScalePixels(
    Math.abs(finite(impact)),
    Math.abs(finite(maxImpact)),
    DAG_MIN_FILL_OPACITY,
    DAG_MAX_FILL_OPACITY,
  );
}

/**
 * Assign every aggregate node its visual column.
 *
 * Topological layers already order the network, but they do not guarantee the
 * reading the view promises: families must be leftmost and the output
 * rightmost even when the model's layer count is smaller than the number of
 * columns needed (a two-layer network, for example). Families are therefore
 * pinned to column 0, outputs to the final column, and everything else is
 * clamped into the columns between them.
 *
 * @param {{ nodes?: Array<object>, meta?: Record<string, unknown> }} model
 * @returns {{ columnByNodeId: Map<string, number>, columnCount: number }}
 */
export function assignDagColumns(model) {
  const nodes = Array.isArray(model?.nodes) ? model.nodes : [];
  const outputIds = new Set(
    Array.isArray(model?.meta?.outputNodeIds) ? model.meta.outputNodeIds : [],
  );
  const familyIds = new Set(
    nodes.filter((n) => n?.kind === "family").map((n) => n.id),
  );
  const middleCount =
    nodes.filter((n) => !familyIds.has(n?.id) && !outputIds.has(n?.id)).length;

  const layerCount = Number.isFinite(model?.meta?.layerCount)
    ? Number(model.meta.layerCount)
    : (Array.isArray(model?.layers) ? model.layers.length : 1);

  const firstMiddle = familyIds.size > 0 ? 1 : 0;
  const outputColumn = Math.max(
    layerCount - 1,
    firstMiddle + (middleCount > 0 ? 1 : 0),
  );
  const lastMiddle = Math.max(firstMiddle, outputColumn - 1);

  /** @type {Map<string, number>} */
  const columnByNodeId = new Map();
  for (const node of nodes) {
    if (familyIds.has(node?.id)) {
      columnByNodeId.set(node.id, 0);
    } else if (outputIds.has(node?.id)) {
      columnByNodeId.set(node.id, outputColumn);
    } else {
      const layer = Number.isFinite(node?.layer) ? node.layer : firstMiddle;
      columnByNodeId.set(
        node.id,
        Math.min(lastMiddle, Math.max(firstMiddle, layer)),
      );
    }
  }

  return { columnByNodeId, columnCount: outputColumn + 1 };
}

/** Human-readable heading for a column. */
function columnLabel(index, columnCount, hasFamilies) {
  if (index === columnCount - 1) return "Output";
  if (index === 0) return hasFamilies ? "Observations" : "Layer 0";
  return `Layer ${index}`;
}

/** Format a 0..1 share as a percentage with one decimal place. */
function formatShare(share) {
  return `${(finite(share) * 100).toFixed(1)}%`;
}

/** Format an impact with enough precision to distinguish weak pathways. */
function formatImpact(impact) {
  const value = finite(impact);
  if (value !== 0 && Math.abs(value) < 0.001) return value.toExponential(2);
  return value.toFixed(3);
}

/**
 * Build the hover tooltip for an aggregate node.
 *
 * Observation summaries come from `extractTooltips` (Issue #521) and are
 * formatted with `buildObservationTooltip`, so a family node surfaces the same
 * "label — description" text a user sees in the trace explorer.
 *
 * @param {{
 *   node: object,
 *   labels?: Record<string, string>,
 *   descriptions?: Record<string, string>,
 *   columnShare?: number,
 *   maxMembers?: number,
 * }} input
 * @returns {string} multi-line tooltip text.
 */
export function buildDagNodeTooltip(input) {
  const {
    node,
    labels = {},
    descriptions = {},
    columnShare = 0,
    maxMembers = DEFAULT_TOOLTIP_MEMBERS,
  } = input ?? {};

  const members = Array.isArray(node?.members) ? node.members : [];
  const memberCount = Number.isFinite(node?.memberCount)
    ? node.memberCount
    : members.length;

  const lines = [];
  if (node?.kind === "family") {
    lines.push(
      `${node.label} — ${pluralise(memberCount, "observation")}`,
    );
  } else if (node?.kind === "collapsed") {
    const reason = node.foldReason ?? "below the impact threshold";
    lines.push(`${node.label} (${reason})`);
  } else {
    const uuid = members[0] ?? node?.id ?? "";
    lines.push(
      buildObservationTooltip({
        uuid,
        label: node?.label ?? null,
        description: descriptions[uuid] ?? null,
      }),
    );
  }

  lines.push(
    `Impact ${formatImpact(node?.impact)} · ${
      formatShare(columnShare)
    } of this column`,
  );

  const listed = members.slice(0, Math.max(0, maxMembers));
  for (const uuid of listed) {
    if (node?.kind !== "family" && members.length === 1) break;
    const text = buildObservationTooltip({
      uuid,
      label: labels[uuid] ?? null,
      description: descriptions[uuid] ?? null,
    });
    if (text) lines.push(`• ${text}`);
  }
  if (memberCount > listed.length && node?.kind !== "neuron") {
    lines.push(`• …and ${memberCount - listed.length} more`);
  }

  return lines.join("\n");
}

/**
 * Build the hover tooltip for an aggregate edge.
 *
 * @param {object} edge
 * @param {Map<string, object>} nodesById
 * @returns {string}
 */
export function buildDagEdgeTooltip(edge, nodesById) {
  const from = nodesById?.get?.(edge?.from);
  const to = nodesById?.get?.(edge?.to);
  const fromLabel = from?.label || edge?.from || "?";
  const toLabel = to?.label || edge?.to || "?";
  return [
    `${fromLabel} → ${toLabel}`,
    `${pluralise(edge?.memberCount ?? 0, "synapse")} · Σw = ${
      finite(edge?.weight).toFixed(2)
    }`,
    `Contribution ${formatImpact(edge?.impact)}`,
  ].join("\n");
}

/**
 * @typedef {object} DagLayoutNode
 * @property {string} id
 * @property {"family"|"neuron"|"collapsed"} kind
 * @property {string} label
 * @property {number} column
 * @property {number} x
 * @property {number} y
 * @property {number} r
 * @property {number} impact
 * @property {number} columnShare — |impact| as a fraction of its column.
 * @property {number} fillOpacity
 * @property {string} colour
 * @property {string} tooltip
 * @property {string[]} members
 * @property {number} memberCount
 * @property {boolean} isOutput
 */

/**
 * Compute the 2D layout for an aggregated layered graph model.
 *
 * Throws when the model carries no nodes — an empty diagram would look like a
 * successfully rendered "empty network" rather than the fault it is.
 *
 * @param {object} model — from `buildAggregatedGraphModel`.
 * @param {{
 *   snapshot?: unknown,
 *   tooltips?: { labels?: Record<string, string>, descriptions?: Record<string, string> }|null,
 *   columnGap?: number,
 *   rowGap?: number,
 *   maxNodesPerColumn?: number,
 * }} [options]
 * @returns {{
 *   width: number,
 *   height: number,
 *   columnCount: number,
 *   columns: Array<{ index: number, label: string, x: number, nodeIds: string[] }>,
 *   nodes: DagLayoutNode[],
 *   edges: Array<object>,
 *   meta: Record<string, unknown>,
 * }}
 */
export function computeDagLayout(model, options = {}) {
  const {
    snapshot = null,
    tooltips = null,
    columnGap = DAG_COLUMN_GAP,
    rowGap = DAG_ROW_GAP,
    maxNodesPerColumn = DAG_MAX_NODES_PER_COLUMN,
  } = options ?? {};

  const modelNodes = Array.isArray(model?.nodes) ? model.nodes : [];
  if (modelNodes.length === 0) {
    throw new Error(
      "computeDagLayout: the aggregated model has no nodes — nothing to render",
    );
  }

  const resolved = tooltips ?? extractTooltips(snapshot);
  const labels = resolved?.labels ?? {};
  const descriptions = resolved?.descriptions ?? {};

  const { columnByNodeId, columnCount } = assignDagColumns(model);
  const outputIds = new Set(
    Array.isArray(model?.meta?.outputNodeIds) ? model.meta.outputNodeIds : [],
  );
  const hasFamilies = modelNodes.some((n) => n?.kind === "family");

  // Column membership, ordered by impact so the strongest pathway reads first.
  /** @type {Map<number, object[]>} */
  const byColumn = new Map();
  for (let i = 0; i < columnCount; i++) byColumn.set(i, []);
  for (const node of modelNodes) {
    const column = columnByNodeId.get(node.id) ?? 0;
    byColumn.get(column)?.push(node);
  }
  for (const column of byColumn.values()) {
    column.sort((a, b) =>
      Math.abs(finite(b.impact)) - Math.abs(finite(a.impact)) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    );
  }

  // Readability beats completeness: at full scale one column can hold
  // thousands of aggregate nodes, which renders as an unreadable wall. Keep
  // the strongest `maxNodesPerColumn - 1` and fold the rest into a single
  // aggregate that states exactly how many nodes it stands for — the folded
  // region is the view's dead-zone signal, never a silent truncation.
  /** @type {Map<string, string>} */
  const remapByNodeId = new Map();
  let foldedNodeCount = 0;
  if (Number.isFinite(maxNodesPerColumn) && maxNodesPerColumn >= 2) {
    for (const [index, column] of byColumn) {
      if (column.length <= maxNodesPerColumn) continue;
      const folded = column.splice(maxNodesPerColumn - 1);
      const foldId = `overflow:column-${index}`;
      const fold = {
        id: foldId,
        kind: "collapsed",
        label: `${folded.length.toLocaleString()} more, folded`,
        foldReason: "below the strongest nodes in this column",
        layer: index,
        members: [],
        memberCount: 0,
        impact: 0,
      };
      for (const node of folded) {
        remapByNodeId.set(node.id, foldId);
        fold.members.push(...(Array.isArray(node.members) ? node.members : []));
        fold.memberCount += Number.isFinite(node.memberCount)
          ? node.memberCount
          : 0;
        fold.impact += finite(node.impact);
      }
      foldedNodeCount += folded.length;
      column.push(fold);
    }
  }

  let maxImpact = 0;
  for (const column of byColumn.values()) {
    for (const node of column) {
      maxImpact = Math.max(maxImpact, Math.abs(finite(node.impact)));
    }
  }

  const maxRows = Math.max(
    1,
    ...Array.from(byColumn.values(), (column) => column.length),
  );
  const halfHeight = TOPO_MAX_NODE_R + 22;
  const height = DAG_PADDING * 2 + DAG_HEADING_HEIGHT +
    Math.max(2 * halfHeight, (maxRows - 1) * rowGap + 2 * halfHeight);
  const width = 2 * (DAG_PADDING + TOPO_MAX_NODE_R) +
    (columnCount - 1) * columnGap;
  const bodyTop = DAG_PADDING + DAG_HEADING_HEIGHT;
  const bodyHeight = height - bodyTop - DAG_PADDING;

  /** @type {DagLayoutNode[]} */
  const nodes = [];
  const columns = [];
  for (let index = 0; index < columnCount; index++) {
    const members = byColumn.get(index) ?? [];
    const x = DAG_PADDING + TOPO_MAX_NODE_R + index * columnGap;
    const columnTotal = members.reduce(
      (acc, n) => acc + Math.abs(finite(n.impact)),
      0,
    );
    const span = (members.length - 1) * rowGap;
    const firstY = bodyTop + (bodyHeight - span) / 2;

    for (let row = 0; row < members.length; row++) {
      const node = members[row];
      const isOutput = outputIds.has(node.id);
      const columnShare = columnTotal > 0
        ? Math.abs(finite(node.impact)) / columnTotal
        : (members.length > 0 ? 1 / members.length : 0);
      nodes.push({
        id: node.id,
        kind: node.kind,
        label: node.label ?? node.id,
        column: index,
        x,
        y: firstY + row * rowGap,
        r: dagNodeRadius(node.impact, maxImpact),
        impact: finite(node.impact),
        columnShare,
        fillOpacity: dagNodeFillOpacity(node.impact, maxImpact),
        colour: isOutput
          ? OUTPUT_COLOUR
          : (COLOUR_BY_KIND[node.kind] ?? "var(--muted)"),
        tooltip: buildDagNodeTooltip({
          node,
          labels,
          descriptions,
          columnShare,
        }),
        members: Array.isArray(node.members) ? node.members.slice() : [],
        memberCount: Number.isFinite(node.memberCount) ? node.memberCount : 0,
        isOutput,
      });
    }

    columns.push({
      index,
      label: columnLabel(index, columnCount, hasFamilies),
      x,
      nodeIds: members.map((n) => n.id),
    });
  }

  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const modelEdges = Array.isArray(model?.edges) ? model.edges : [];

  // Edges of folded nodes are re-pointed onto their fold aggregate and merged,
  // so a folded region still shows the traffic it carries.
  /** @type {Map<string, object>} */
  const mergedEdges = new Map();
  let foldedSelfEdgeCount = 0;
  for (const edge of modelEdges) {
    const from = remapByNodeId.get(edge.from) ?? edge.from;
    const to = remapByNodeId.get(edge.to) ?? edge.to;
    if (!nodesById.has(from) || !nodesById.has(to)) continue;
    if (from === to) {
      foldedSelfEdgeCount += 1;
      continue;
    }
    const id = `${from}=>${to}`;
    let merged = mergedEdges.get(id);
    if (!merged) {
      merged = { id, from, to, weight: 0, impact: 0, memberCount: 0 };
      mergedEdges.set(id, merged);
    }
    merged.weight += finite(edge.weight);
    merged.impact += finite(edge.impact);
    merged.memberCount += Number.isFinite(edge.memberCount)
      ? edge.memberCount
      : 0;
  }

  let maxEdgeImpact = 0;
  let maxAbsWeight = 0;
  for (const edge of mergedEdges.values()) {
    maxEdgeImpact = Math.max(maxEdgeImpact, Math.abs(edge.impact));
    maxAbsWeight = Math.max(maxAbsWeight, Math.abs(edge.weight));
  }

  const edges = [];
  for (const edge of mergedEdges.values()) {
    const from = nodesById.get(edge.from);
    const to = nodesById.get(edge.to);
    const forwards = to.x >= from.x;
    edges.push({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      x1: from.x + (forwards ? from.r : -from.r),
      y1: from.y,
      x2: to.x - (forwards ? to.r : -to.r),
      y2: to.y,
      width: dagLinkWidth(edge.impact, maxEdgeImpact),
      colour: divergingWeightSumColourCss(edge.weight, maxAbsWeight),
      impact: edge.impact,
      weight: edge.weight,
      memberCount: edge.memberCount,
      tooltip: buildDagEdgeTooltip(edge, nodesById),
    });
  }

  return {
    width,
    height,
    columnCount,
    columns,
    nodes,
    edges,
    meta: {
      ...(model?.meta ?? {}),
      maxNodeImpact: maxImpact,
      maxEdgeImpact,
      maxNodesPerColumn,
      foldedNodeCount,
      foldedSelfEdgeCount,
      rowGap,
      columnGap,
    },
  };
}

/** Elide a long label so it does not overrun its column. */
function elide(text, max = MAX_LABEL_CHARS) {
  const s = String(text ?? "");
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/**
 * Render a layout as a standalone SVG string.
 *
 * Every node and edge carries a `<title>` so the browser shows the tooltip on
 * hover, and a `data-node-id` / `data-edge-id` so the view can wire selection
 * without re-deriving geometry.
 *
 * @param {ReturnType<typeof computeDagLayout>} layout
 * @returns {string}
 */
export function dagLayoutToSvgString(layout) {
  const width = finite(layout?.width) || 1;
  const height = finite(layout?.height) || 1;
  const parts = [];

  parts.push(
    // Natural pixel size, not `width="100%"`: the diagram is wider than a
    // phone (and often a desktop) viewport, so the container scrolls rather
    // than scaling every node down into an unreadable smear.
    `<svg class="dagSvg" viewBox="0 0 ${width} ${height}" ` +
      `width="${width}" height="${height}" role="img" ` +
      `aria-label="Layered network diagram: observations on the left, ` +
      `output on the right" xmlns="http://www.w3.org/2000/svg">`,
  );

  // Column headings.
  for (const column of layout?.columns ?? []) {
    parts.push(
      `<text class="dagColumnLabel" x="${finite(column.x)}" ` +
        `y="${DAG_PADDING}" text-anchor="middle">` +
        `${escapeHtml(column.label)}</text>`,
    );
  }

  // Edges first so nodes sit on top.
  parts.push(`<g class="dagEdges">`);
  for (const edge of layout?.edges ?? []) {
    const dx = Math.max(24, (finite(edge.x2) - finite(edge.x1)) / 2);
    const d = `M${finite(edge.x1)},${finite(edge.y1)} ` +
      `C${finite(edge.x1) + dx},${finite(edge.y1)} ` +
      `${finite(edge.x2) - dx},${finite(edge.y2)} ` +
      `${finite(edge.x2)},${finite(edge.y2)}`;
    parts.push(
      `<g class="dagEdge" data-edge-id="${escapeHtml(edge.id)}">` +
        `<title>${escapeHtml(edge.tooltip)}</title>` +
        `<path d="${d}" fill="none" stroke="${escapeHtml(edge.colour)}" ` +
        `stroke-width="${finite(edge.width)}" stroke-opacity="0.75" />` +
        `</g>`,
    );
  }
  parts.push(`</g>`);

  parts.push(`<g class="dagNodes">`);
  for (const node of layout?.nodes ?? []) {
    const x = finite(node.x);
    const y = finite(node.y);
    const r = finite(node.r);
    parts.push(
      `<g class="dagNode" data-node-id="${escapeHtml(node.id)}" ` +
        `data-kind="${escapeHtml(node.kind)}">` +
        `<title>${escapeHtml(node.tooltip)}</title>` +
        `<circle cx="${x}" cy="${y}" r="${r}" ` +
        `fill="${escapeHtml(node.colour)}" ` +
        `fill-opacity="${finite(node.fillOpacity)}" />` +
        `<text class="dagNodeLabel" x="${x}" y="${y + r + 14}" ` +
        `text-anchor="middle">${escapeHtml(elide(node.label))}</text>` +
        `</g>`,
    );
  }
  parts.push(`</g>`);

  parts.push(`</svg>`);
  return parts.join("");
}

/**
 * Legend markup for the DAG view — mirrors the encodings above so the diagram
 * is readable without prior knowledge.
 *
 * @returns {string}
 */
export function dagLegendHtml() {
  return `<dl class="dagLegend" aria-label="Diagram legend">` +
    `<div class="dagLegendRow"><dt>Columns</dt>` +
    `<dd>observations → hidden layers → output</dd></div>` +
    `<div class="dagLegendRow"><dt>Node size &amp; intensity</dt>` +
    `<dd>impact on the Score (log)</dd></div>` +
    `<div class="dagLegendRow"><dt>Link width</dt>` +
    `<dd>contribution carried by the merged synapses (log)</dd></div>` +
    `<div class="dagLegendRow"><dt>Link colour</dt>` +
    `<dd>sum of weights (red negative → blue positive)</dd></div>` +
    `<div class="dagLegendRow"><dt>Grey node</dt>` +
    `<dd>folded low-impact neurons — a candidate dead zone</dd></div>` +
    `</dl>`;
}
