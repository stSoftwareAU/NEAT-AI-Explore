/**
 * Sankey contribution-flow model (Issue #526).
 *
 * A contrasting candidate to the layered DAG view. Where the DAG draws nodes and
 * edges, the Sankey draws *flow*: the band into each output is the Score, and
 * every band upstream is proportional to the contribution that reaches that
 * Score. This module is the DOM-free core the browser view renders — geometry
 * and SVG live in `docs/sankey/sankey.js`, the conserved-flow maths live here so
 * they can be unit-tested under Deno.
 *
 * Input is the aggregated layered graph model (`aggregated_graph_model.js`),
 * which has already dropped dead neurons, assigned topological layers, attached
 * per-node and per-edge impact, grouped inputs into observation families and
 * collapsed low-impact neurons. This module turns that model into a *conserved*
 * Sankey:
 *
 *  - Output nodes are seeded with their impact — the Score total.
 *  - Walking layers back-to-front, each node's throughput is split across its
 *    inbound edges in proportion to the edge's contribution (impact, falling
 *    back to |weight| when no impact was attributed).
 *  - Because every node's inbound bands sum exactly to its throughput, the
 *    diagram conserves flow: the layer-0 family bands sum back to the Score.
 *
 * That conservation is the whole point of a Sankey here — it makes "how does the
 * Score decompose across observation families?" a proportional, readable
 * picture, while thin/absent bands surface dead zones and a single family's
 * band can be traced forward to the output.
 *
 * @example
 * const model = buildAggregatedGraphModel(snapshot);
 * const flow = buildSankeyFlow(model, { labels, descriptions });
 * flow.links.forEach((l) => drawBand(l, bandWidth(l.value, pxPerUnit)));
 */

import { buildObservationTooltip } from "./ui_helpers.js";

/**
 * Readability budget. The raw graph is 2,461 inputs / 21,492 synapses; the
 * aggregated model collapses that, and these caps let a view report loudly when
 * an unusually wide snapshot still exceeds a legible band count rather than
 * silently drawing an unreadable diagram.
 */
export const DEFAULT_MAX_SANKEY_NODES = 80;
/**
 * Link budget. Bands overlap and fade, so a Sankey tolerates far more links than
 * distinct nodes before it stops reading. The published snapshot is deeply
 * skip-connected (~500 aggregated flows after per-layer folding, down from
 * 21,492 raw synapses) and still renders legibly; the budget flags only a
 * genuinely pathological diagram beyond that.
 */
export const DEFAULT_MAX_SANKEY_LINKS = 640;

/**
 * The aggregated model collapses low-impact *hidden* neurons, but a snapshot
 * whose observations carry no tooltip `group` explodes into thousands of
 * single-observation family nodes at layer 0 (2,132 families in the published
 * snapshot). To stay legible the Sankey keeps the highest-contribution nodes in
 * each layer and folds the long tail into one per-layer "other" node — the
 * aggregation-first requirement, applied by rank rather than a fixed threshold.
 */
export const DEFAULT_MAX_NODES_PER_LAYER = 12;

/** Contribution weight used to split a node's flow across its inbound edges. */
function edgeContribution(edge) {
  const impact = Math.abs(Number(edge?.impact) || 0);
  if (impact > 0) return impact;
  // No impact attributed (e.g. output-share budget skipped) — fall back to the
  // summed |weight| the model already carries so bands still reflect strength.
  return Math.abs(Number(edge?.absWeight) || 0);
}

/**
 * Fold each layer's low-contribution nodes into a single per-layer "other"
 * node, keeping the `maxPerLayer` highest-|impact| nodes (output nodes are
 * always kept). Edges are re-pointed at the surviving/other node, self-loops
 * dropped, and parallel edges merged — so the reduced graph stays a conserved
 * layered DAG that the flow assignment can consume unchanged.
 *
 * @returns {{ nodes: Array<object>, edges: Array<object>, foldedNodeCount: number }}
 */
function foldLowRankNodes(model, maxPerLayer, outputIds) {
  const byLayer = new Map();
  for (const node of model.nodes) {
    if (!byLayer.has(node.layer)) byLayer.set(node.layer, []);
    byLayer.get(node.layer).push(node);
  }

  /** @type {Map<string, string>} renderId per original node id. */
  const renderIdByOriginal = new Map();
  /** @type {Map<string, object>} reduced nodes keyed by render id. */
  const reduced = new Map();
  /** @type {Map<number, { members: string[], impact: number, count: number, families: number }>} */
  const otherByLayer = new Map();
  let foldedNodeCount = 0;

  for (const [layer, nodes] of byLayer) {
    const ranked = nodes.slice().sort((a, b) =>
      Math.abs(b.impact ?? 0) - Math.abs(a.impact ?? 0) ||
      (a.id < b.id ? -1 : 1)
    );
    let kept = 0;
    for (const node of ranked) {
      const forceKeep = outputIds.has(node.id);
      if (forceKeep || kept < maxPerLayer) {
        renderIdByOriginal.set(node.id, node.id);
        reduced.set(node.id, {
          id: node.id,
          kind: node.kind,
          label: node.label,
          layer: node.layer,
          impact: node.impact ?? 0,
          members: Array.isArray(node.members) ? node.members.slice() : [],
          memberCount: node.memberCount ?? 0,
        });
        kept += 1;
      } else {
        const otherId = `other:layer-${layer}`;
        renderIdByOriginal.set(node.id, otherId);
        if (!otherByLayer.has(layer)) {
          otherByLayer.set(layer, {
            members: [],
            impact: 0,
            count: 0,
            families: 0,
          });
        }
        const bucket = otherByLayer.get(layer);
        bucket.members.push(...(node.members ?? []));
        bucket.impact += node.impact ?? 0;
        bucket.count += 1;
        if (node.kind === "family") bucket.families += 1;
        foldedNodeCount += 1;
      }
    }
  }

  for (const [layer, bucket] of otherByLayer) {
    const id = `other:layer-${layer}`;
    const allFamilies = bucket.families === bucket.count;
    const label = allFamilies
      ? `${bucket.count} minor observation families`
      : `${bucket.count} minor pathways`;
    reduced.set(id, {
      id,
      kind: "other",
      label,
      layer,
      impact: bucket.impact,
      members: bucket.members.sort(),
      memberCount: bucket.members.length,
      otherCount: bucket.count,
    });
  }

  // Re-point and merge edges over the reduced node set.
  const edgeById = new Map();
  for (const edge of model.edges) {
    const from = renderIdByOriginal.get(edge.from);
    const to = renderIdByOriginal.get(edge.to);
    if (!from || !to || from === to) continue;
    const id = `${from}=>${to}`;
    let merged = edgeById.get(id);
    if (!merged) {
      merged = {
        id,
        from,
        to,
        weight: 0,
        absWeight: 0,
        impact: 0,
        members: [],
        memberCount: 0,
      };
      edgeById.set(id, merged);
    }
    merged.weight += edge.weight ?? 0;
    merged.absWeight += edge.absWeight ?? 0;
    merged.impact += edge.impact ?? 0;
    if (Array.isArray(edge.members)) merged.members.push(...edge.members);
  }
  const edges = Array.from(edgeById.values());
  for (const edge of edges) edge.memberCount = edge.members.length;

  return { nodes: Array.from(reduced.values()), edges, foldedNodeCount };
}

/** Build the per-node tooltip, reusing the #521 observation-summary helper. */
function buildNodeTooltip(node, labels, descriptions) {
  if (node.kind === "other") {
    return `${node.label} (folded to keep the diagram readable)`;
  }
  if (node.kind === "family") {
    const shown = node.members.slice(0, 6).map((uuid) =>
      buildObservationTooltip({
        uuid,
        label: labels?.[uuid],
        description: descriptions?.[uuid],
      })
    );
    const more = node.memberCount - shown.length;
    const header = `${node.label} — ${node.memberCount} observation${
      node.memberCount === 1 ? "" : "s"
    }`;
    const lines = more > 0 ? shown.concat(`+${more} more`) : shown;
    return lines.length > 0 ? `${header}\n${lines.join("\n")}` : header;
  }
  if (node.kind === "collapsed") {
    return `${node.label} (folded below the aggregation threshold)`;
  }
  // A single neuron (hidden or output): show its observation summary.
  const uuid = node.members[0] ?? node.id;
  return buildObservationTooltip({
    uuid,
    label: labels?.[uuid] ?? node.label,
    description: descriptions?.[uuid],
  });
}

/**
 * Pixel width for a band carrying `value` units of flow.
 *
 * Linear in `value` so bands are strictly proportional to contribution; a
 * `minPx` floor keeps a non-zero band visible (and tappable) without distorting
 * the comparison between larger bands.
 *
 * @param {number} value — flow carried by the band.
 * @param {number} pxPerUnit — pixels per unit of flow.
 * @param {number} [minPx] — minimum rendered width for a positive band.
 * @returns {number}
 */
export function bandWidth(value, pxPerUnit, minPx = 1) {
  const v = Number(value);
  const scale = Number(pxPerUnit);
  if (!(v > 0) || !(scale > 0)) return 0;
  return Math.max(minPx, v * scale);
}

/**
 * Trace a node's full contribution path through the conserved flow (Issue #537).
 *
 * Troubleshooting a Sankey means following one family's flow to the output: this
 * walks every band that *feeds* the node back to its source families (upstream)
 * and every band that *flows from* the node through to the output (downstream),
 * returning the ids of every band and node on that path. The view highlights the
 * returned ids and dims the rest — but the traversal is kept here, DOM-free, so
 * it can be unit-tested and the view only toggles CSS classes.
 *
 * Only `flow.links` (`{ id, source, target }`) is read, so a hand-built fixture
 * works as well as a real `buildSankeyFlow` result. An isolated node (no bands)
 * traces to just itself with no links — the honest "nothing flows here" answer.
 *
 * @param {{ links?: SankeyLink[] }} flow
 * @param {string} nodeId — the selected node's id.
 * @returns {{
 *   nodeIds: string[],
 *   linkIds: string[],
 *   upstreamLinkIds: string[],
 *   downstreamLinkIds: string[],
 * }} sorted for deterministic output.
 */
export function traceNodeFlow(flow, nodeId) {
  const links = Array.isArray(flow?.links) ? flow.links : [];
  /** @type {Map<string, SankeyLink[]>} inbound bands keyed by target node. */
  const inbound = new Map();
  /** @type {Map<string, SankeyLink[]>} outbound bands keyed by source node. */
  const outbound = new Map();
  for (const link of links) {
    if (!inbound.has(link.target)) inbound.set(link.target, []);
    inbound.get(link.target).push(link);
    if (!outbound.has(link.source)) outbound.set(link.source, []);
    outbound.get(link.source).push(link);
  }

  const nodeIds = new Set([nodeId]);

  /** BFS along one direction, collecting the bands and nodes reached. */
  const walk = (adjacency, nextKey) => {
    const reachedLinks = new Set();
    const seen = new Set([nodeId]);
    const queue = [nodeId];
    while (queue.length > 0) {
      const current = queue.shift();
      for (const link of adjacency.get(current) ?? []) {
        reachedLinks.add(link.id);
        const next = link[nextKey];
        nodeIds.add(next);
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return reachedLinks;
  };

  const upstreamLinkIds = walk(inbound, "source");
  const downstreamLinkIds = walk(outbound, "target");
  const linkIds = new Set([...upstreamLinkIds, ...downstreamLinkIds]);

  const sorted = (set) => Array.from(set).sort();
  return {
    nodeIds: sorted(nodeIds),
    linkIds: sorted(linkIds),
    upstreamLinkIds: sorted(upstreamLinkIds),
    downstreamLinkIds: sorted(downstreamLinkIds),
  };
}

/**
 * Trace a single band selection (Issue #537): the band and both its endpoints.
 *
 * @param {{ links?: SankeyLink[] }} flow
 * @param {string} linkId — the selected band's id.
 * @returns {{ nodeIds: string[], linkIds: string[] }} sorted; empty when the
 *   band is unknown.
 */
export function traceLinkFlow(flow, linkId) {
  const links = Array.isArray(flow?.links) ? flow.links : [];
  const link = links.find((l) => l.id === linkId);
  if (!link) return { nodeIds: [], linkIds: [] };
  return {
    nodeIds: [link.source, link.target].sort(),
    linkIds: [linkId],
  };
}

/**
 * @typedef {object} SankeyNode
 * @property {string} id
 * @property {"family"|"neuron"|"collapsed"} kind
 * @property {string} label
 * @property {number} layer
 * @property {number} value — throughput (flow through the node) = band height.
 * @property {number} impact — the model's per-node impact.
 * @property {string[]} members
 * @property {number} memberCount
 * @property {boolean} isOutput
 * @property {string} tooltip
 */

/**
 * @typedef {object} SankeyLink
 * @property {string} id
 * @property {string} source — source node id.
 * @property {string} target — target node id.
 * @property {number} value — flow carried (band width) ∝ contribution to Score.
 * @property {number} weight — signed summed synapse weight (colour hint).
 * @property {number} absWeight
 * @property {number} impact — the model's per-edge impact.
 */

/**
 * Build the conserved Sankey contribution-flow from an aggregated graph model.
 *
 * Throws when the model is missing its `{ nodes, edges, layers }` shape — an
 * absent model is a fault to surface, not an empty diagram to render.
 *
 * @param {{
 *   nodes: Array<object>,
 *   edges: Array<object>,
 *   layers: Array<{ index: number, nodeIds: string[] }>,
 *   meta?: Record<string, unknown>,
 * }} model — output of `buildAggregatedGraphModel`.
 * @param {{
 *   labels?: Record<string, string>,
 *   descriptions?: Record<string, string>,
 *   maxNodes?: number,
 *   maxLinks?: number,
 * }} [options]
 * @returns {{
 *   nodes: SankeyNode[],
 *   links: SankeyLink[],
 *   columns: Array<{ index: number, nodeIds: string[] }>,
 *   totalScore: number,
 *   meta: Record<string, unknown>,
 * }}
 */
export function buildSankeyFlow(model, options = {}) {
  if (
    !model || !Array.isArray(model.nodes) || !Array.isArray(model.edges) ||
    !Array.isArray(model.layers)
  ) {
    throw new Error(
      "buildSankeyFlow requires an aggregated graph model with nodes, edges and layers",
    );
  }

  const {
    labels = {},
    descriptions = {},
    maxNodes = DEFAULT_MAX_SANKEY_NODES,
    maxLinks = DEFAULT_MAX_SANKEY_LINKS,
    maxNodesPerLayer = DEFAULT_MAX_NODES_PER_LAYER,
  } = options ?? {};

  // Output node ids come from the model's meta; fall back to the final layer's
  // declared output-kind neurons if meta is unavailable.
  const layerCount = model.layers.length;
  const metaOutputs = Array.isArray(model.meta?.outputNodeIds)
    ? model.meta.outputNodeIds
    : null;
  const outputIds = new Set(
    metaOutputs ?? model.nodes
      .filter((n) => n.kind === "neuron" && n.layer === layerCount - 1)
      .map((n) => n.id),
  );

  // Aggregation-first: fold each layer's low-contribution tail into one "other"
  // node so the diagram stays readable even when inputs explode into thousands
  // of single-observation families.
  const { nodes: modelNodes, edges: modelEdges, foldedNodeCount } =
    foldLowRankNodes(model, maxNodesPerLayer, outputIds);

  const nodeById = new Map(modelNodes.map((n) => [n.id, n]));

  // Index inbound edges per target node.
  /** @type {Map<string, Array<object>>} */
  const inboundByTo = new Map();
  for (const edge of modelEdges) {
    if (!inboundByTo.has(edge.to)) inboundByTo.set(edge.to, []);
    inboundByTo.get(edge.to).push(edge);
  }

  // Seed output throughput with the Score, then propagate flow backwards.
  /** @type {Map<string, number>} */
  const nodeFlow = new Map();
  let totalScore = 0;
  for (const id of outputIds) {
    const impact = Math.abs(Number(nodeById.get(id)?.impact) || 0);
    nodeFlow.set(id, impact);
    totalScore += impact;
  }

  /** @type {Map<string, number>} */
  const linkValue = new Map();
  // Edges advance layers (from.layer < to.layer), so processing nodes by
  // descending layer guarantees a node's full throughput is known before it is
  // distributed across its inbound edges — the flow stays conserved.
  const byLayerDesc = modelNodes.slice().sort((a, b) => b.layer - a.layer);
  for (const node of byLayerDesc) {
    const throughput = nodeFlow.get(node.id) ?? 0;
    const inbound = inboundByTo.get(node.id) ?? [];
    if (inbound.length === 0 || throughput <= 0) continue;

    let totalW = 0;
    for (const edge of inbound) totalW += edgeContribution(edge);

    for (const edge of inbound) {
      // Split by contribution; when no edge carries weight, share evenly so the
      // throughput is still fully accounted for rather than vanishing.
      const share = totalW > 0
        ? edgeContribution(edge) / totalW
        : 1 / inbound.length;
      const carried = throughput * share;
      linkValue.set(edge.id, (linkValue.get(edge.id) ?? 0) + carried);
      nodeFlow.set(edge.from, (nodeFlow.get(edge.from) ?? 0) + carried);
    }
  }

  const nodes = modelNodes.map((n) => ({
    id: n.id,
    kind: n.kind,
    label: n.label,
    layer: n.layer,
    value: nodeFlow.get(n.id) ?? 0,
    impact: n.impact,
    members: Array.isArray(n.members) ? n.members : [],
    memberCount: n.memberCount,
    isOutput: outputIds.has(n.id),
    tooltip: buildNodeTooltip(n, labels, descriptions),
  }));

  const links = modelEdges
    .map((edge) => ({
      id: edge.id,
      source: edge.from,
      target: edge.to,
      value: linkValue.get(edge.id) ?? 0,
      weight: edge.weight,
      absWeight: edge.absWeight,
      impact: edge.impact,
    }))
    // A zero-flow band would be invisible; drop it so the diagram stays legible
    // and the link budget reflects only bands the viewer can actually see.
    .filter((l) => l.value > 0)
    .sort((a, b) => b.value - a.value || (a.id < b.id ? -1 : 1));

  // Flow entering the output column — must equal the Score by construction.
  let inboundToOutputs = 0;
  for (const link of links) {
    if (outputIds.has(link.target)) inboundToOutputs += link.value;
  }

  // Source nodes (no inbound band) are where flow originates — the observation
  // families at layer 0. Their throughput sums back to the Score.
  const targeted = new Set(links.map((l) => l.target));
  const sourceFlowTotal = nodes
    .filter((n) => !targeted.has(n.id))
    .reduce((acc, n) => acc + n.value, 0);

  const withinBudget = nodes.length <= maxNodes && links.length <= maxLinks;

  // Columns from the reduced node set, so a view can lay out by layer directly.
  const columnMap = new Map();
  for (const node of nodes) {
    if (!columnMap.has(node.layer)) columnMap.set(node.layer, []);
    columnMap.get(node.layer).push(node.id);
  }
  const columns = Array.from(columnMap.keys())
    .sort((a, b) => a - b)
    .map((index) => ({ index, nodeIds: columnMap.get(index).sort() }));

  return {
    nodes,
    links,
    columns,
    totalScore,
    meta: {
      totalScore,
      inboundToOutputs,
      sourceFlowTotal,
      nodeCount: nodes.length,
      linkCount: links.length,
      foldedNodeCount,
      maxNodes,
      maxLinks,
      maxNodesPerLayer,
      withinBudget,
      layerCount,
      outputNodeIds: Array.from(outputIds).sort(),
      collapsedNeuronCount: model.meta?.collapsedNeuronCount ?? 0,
      rawNeuronCount: model.meta?.neuronCount ?? nodes.length,
      rawSynapseCount: model.meta?.synapseCount ?? links.length,
      outputSharesComputed: model.meta?.outputSharesComputed ?? false,
    },
  };
}
