/**
 * Aggregated layered graph model (Issue #524).
 *
 * The shared, DOM-free data foundation every candidate replacement graph view
 * consumes. At the default published snapshot scale (2,461 inputs, 1,655
 * hidden, 1 output, 21,492 synapses) the raw graph is unreadable, so the model
 * aggregates *before* any view renders it:
 *
 *  - **inputs** collapse into one node per observation family
 *    (see `observation_families.js`);
 *  - **neurons** are assigned topological layers from the existing adjacency
 *    helpers in `graph_analysis.js`;
 *  - **impact** is attached per node and per edge from `impact_attribution.js`
 *    — client-side, with no new upstream artefacts;
 *  - **low-impact neurons** fold into a per-layer aggregate behind a tunable
 *    threshold, so readability beats completeness.
 *
 * Every aggregate node keeps its `members` (the underlying neuron UUIDs) and a
 * stable `id`, so a later per-stock or stock-comparison view can re-expand or
 * re-weight an aggregate without a rewrite of this model.
 *
 * Output is deterministic — nodes, edges, layers and families are all sorted —
 * so a view can diff two models or memoise on a serialised form.
 *
 * @example
 * const model = buildAggregatedGraphModel(snapshot, { collapseThreshold: 0.02 });
 * model.layers.forEach((layer) => renderColumn(layer.nodeIds));
 */

import { normaliseCreature } from "./snapshot_loader.js";
import { extractTooltips } from "./ui_helpers.js";
import {
  buildGraphIndex,
  computeReachableToOutputs,
} from "./graph_analysis.js";
import { groupObservationsByFamily } from "./observation_families.js";
import {
  computeImpactBreakdownToOutputs,
  computeInboundSynapseImpactAllocation,
} from "../impact_attribution.js";

/**
 * Neurons whose impact is below `collapseThreshold × strongest impact` fold
 * into their layer's aggregate node. 1% keeps the handful of pathways that
 * actually drive the output.
 */
export const DEFAULT_COLLAPSE_THRESHOLD = 0.01;

/**
 * Per-node output attribution enumerates paths, so it is only run while the
 * aggregated graph is small. Above this node count it is skipped and
 * `meta.outputSharesComputed` reports `false` rather than the model silently
 * returning empty shares.
 */
export const DEFAULT_MAX_ATTRIBUTION_NODES = 400;

/** Key used for `derived.synapses` lookups and aggregate edge membership. */
function synapseKey(fromUuid, toUuid) {
  return `${fromUuid}→${toUuid}`;
}

/** Natural-order UUID comparison so `input-2` sorts before `input-10`. */
function compareUuid(a, b) {
  const ma = /^(.*?)(\d+)$/.exec(a);
  const mb = /^(.*?)(\d+)$/.exec(b);
  if (ma && mb && ma[1] === mb[1]) return Number(ma[2]) - Number(mb[2]);
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Assign each neuron a topological layer (rank).
 *
 * Ranks come from a longest-path Kahn sweep: a node sits one layer past its
 * deepest resolved predecessor. Recurrent networks are handled by resolving
 * the acyclic prefix first and then ranking the remaining cycle members in
 * UUID order against whichever predecessors are already resolved — so the
 * function always terminates and always returns an integer layer per node.
 *
 * Output neurons are pinned to the final layer so a layered view can render
 * them as one right-hand column.
 *
 * @param {{
 *   synapses: Array<{ fromUuid: string, toUuid: string }>,
 *   inputUuids?: string[],
 *   outputUuids?: string[],
 * }} input
 * @returns {{ layerByUuid: Map<string, number>, layerCount: number }}
 */
export function assignNeuronLayers(input) {
  const synapses = Array.isArray(input?.synapses) ? input.synapses : [];
  const inputUuids = Array.isArray(input?.inputUuids) ? input.inputUuids : [];
  const outputUuids = Array.isArray(input?.outputUuids)
    ? input.outputUuids
    : [];

  /** @type {Set<string>} */
  const nodes = new Set();
  for (const s of synapses) {
    if (s?.fromUuid) nodes.add(s.fromUuid);
    if (s?.toUuid) nodes.add(s.toUuid);
  }
  for (const u of inputUuids) if (u) nodes.add(u);
  for (const u of outputUuids) if (u) nodes.add(u);

  /** @type {Map<string, string[]>} */
  const outgoing = new Map();
  /** @type {Map<string, string[]>} */
  const incoming = new Map();
  /** @type {Map<string, number>} */
  const indegree = new Map();
  for (const n of nodes) {
    outgoing.set(n, []);
    incoming.set(n, []);
    indegree.set(n, 0);
  }
  for (const s of synapses) {
    const from = s?.fromUuid;
    const to = s?.toUuid;
    if (!nodes.has(from) || !nodes.has(to) || from === to) continue;
    outgoing.get(from).push(to);
    incoming.get(to).push(from);
    indegree.set(to, indegree.get(to) + 1);
  }

  /** @type {Map<string, number>} */
  const layerByUuid = new Map();
  const queue = Array.from(nodes)
    .filter((n) => indegree.get(n) === 0)
    .sort(compareUuid);
  for (const n of queue) layerByUuid.set(n, 0);

  const resolved = new Set(queue);
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    const curLayer = layerByUuid.get(cur) ?? 0;
    for (const to of outgoing.get(cur)) {
      layerByUuid.set(to, Math.max(layerByUuid.get(to) ?? 0, curLayer + 1));
      const remaining = indegree.get(to) - 1;
      indegree.set(to, remaining);
      if (remaining === 0) {
        resolved.add(to);
        queue.push(to);
      }
    }
  }

  // Cycle members: rank against already-resolved predecessors, in UUID order.
  for (const n of Array.from(nodes).sort(compareUuid)) {
    if (resolved.has(n)) continue;
    let best = -1;
    for (const from of incoming.get(n)) {
      if (!resolved.has(from)) continue;
      best = Math.max(best, layerByUuid.get(from) ?? 0);
    }
    layerByUuid.set(n, best + 1);
    resolved.add(n);
  }

  let maxLayer = 0;
  for (const layer of layerByUuid.values()) {
    maxLayer = Math.max(maxLayer, layer);
  }
  for (const o of outputUuids) {
    if (nodes.has(o)) layerByUuid.set(o, maxLayer);
  }

  return { layerByUuid, layerCount: maxLayer + 1 };
}

/** Collect the snapshot's output neuron UUIDs, synthesising them if absent. */
function collectOutputUuids(neuronsByUuid, creature) {
  const declared = Array.from(neuronsByUuid.values())
    .filter((n) => n?.type === "output" && typeof n.uuid === "string")
    .map((n) => n.uuid);
  if (declared.length > 0) return declared.sort(compareUuid);

  const count = Number(creature?.output) || 0;
  const synthesised = [];
  for (let i = 0; i < count; i++) synthesised.push(`output-${i}`);
  return synthesised;
}

/**
 * @typedef {object} AggregateNode
 * @property {string} id — stable identity (`family:…`, `neuron:…`, `collapsed:…`).
 * @property {"family"|"neuron"|"collapsed"} kind
 * @property {string} label
 * @property {number} layer
 * @property {string[]} members — underlying neuron UUIDs.
 * @property {number} memberCount
 * @property {number} impact — sum of member impacts.
 * @property {Array<{ nodeId: string, share: number }>} outputShares
 */

/**
 * @typedef {object} AggregateEdge
 * @property {string} id — `${from}=>${to}`.
 * @property {string} from — aggregate node id.
 * @property {string} to — aggregate node id.
 * @property {number} weight — signed sum of member synapse weights.
 * @property {number} absWeight — sum of |weight| across member synapses.
 * @property {number} impact — allocated impact carried by the merged synapses.
 * @property {string[]} members — member synapse keys (`from→to`).
 * @property {number} memberCount
 */

/**
 * Build the aggregated, layered graph model for a snapshot.
 *
 * Throws when the snapshot carries no creature — a missing network is a fault
 * to surface, not an empty model to render.
 *
 * @param {unknown} snapshot — raw snapshot JSON.
 * @param {{
 *   collapseThreshold?: number,
 *   deriveFamily?: Function|null,
 *   maxAttributionNodes?: number,
 *   maxDepth?: number,
 *   maxPaths?: number,
 * }} [options]
 * @returns {{
 *   nodes: AggregateNode[],
 *   edges: AggregateEdge[],
 *   layers: Array<{ index: number, nodeIds: string[] }>,
 *   families: import("./observation_families.js").ObservationFamily[],
 *   meta: Record<string, unknown>,
 * }}
 */
export function buildAggregatedGraphModel(snapshot, options = {}) {
  const {
    collapseThreshold = DEFAULT_COLLAPSE_THRESHOLD,
    deriveFamily = null,
    maxAttributionNodes = DEFAULT_MAX_ATTRIBUTION_NODES,
    maxDepth = 12,
    maxPaths = 5000,
  } = options ?? {};

  // Fails loudly when the snapshot has no creature (Issue #524).
  const { creature, neuronsByUuid, synapses } = normaliseCreature(snapshot);
  const { labels, groups } = extractTooltips(snapshot);

  const outputUuids = collectOutputUuids(neuronsByUuid, creature);
  const outputSet = new Set(outputUuids);

  // 1. Drop neurons that cannot influence any output — they are pure noise in
  //    a layered view.
  const { incomingByTo } = buildGraphIndex(synapses);
  const reachable = computeReachableToOutputs({ outputUuids, incomingByTo });
  const kept = Array.from(neuronsByUuid.keys())
    .filter((uuid) => reachable.has(uuid))
    .sort(compareUuid);
  const keptSet = new Set(kept);
  const keptSynapses = synapses.filter((s) =>
    keptSet.has(s.fromUuid) && keptSet.has(s.toUuid)
  );

  const keptInputs = kept.filter((u) => neuronsByUuid.get(u)?.type === "input");
  const keptOutputs = kept.filter((u) => outputSet.has(u));
  const keptHidden = kept.filter((u) =>
    !outputSet.has(u) && neuronsByUuid.get(u)?.type !== "input"
  );

  // 2. Topological layers.
  const { layerByUuid, layerCount } = assignNeuronLayers({
    synapses: keptSynapses,
    inputUuids: keptInputs,
    outputUuids: keptOutputs,
  });

  // 3. Per-synapse allocation shares, from the same heuristic the trace
  //    explorer uses. Duplicated (from, to) pairs sum their shares.
  const derivedSynapses = snapshot?.derived?.synapses ?? {};
  /** @type {Map<string, Array<{fromUuid: string, toUuid: string, weight: number}>>} */
  const inboundByTo = new Map();
  for (const s of keptSynapses) {
    if (!inboundByTo.has(s.toUuid)) inboundByTo.set(s.toUuid, []);
    inboundByTo.get(s.toUuid).push(s);
  }
  /** @type {Map<string, number>} */
  const shareByEdge = new Map();
  for (const [toUuid, inbound] of inboundByTo) {
    const allocation = computeInboundSynapseImpactAllocation({
      toUuid,
      neuronImpact: null,
      inboundSynapses: inbound.map((s) => {
        const stats = derivedSynapses?.[synapseKey(s.fromUuid, s.toUuid)];
        return {
          fromUuid: s.fromUuid,
          toUuid: s.toUuid,
          weight: s.weight,
          meanContribution: stats?.stats?.meanContribution ?? null,
          contributions: Array.isArray(stats?.contribution)
            ? stats.contribution
            : null,
        };
      }),
      toNeuronSquash: neuronsByUuid.get(toUuid)?.squash ?? null,
    });
    for (const row of (allocation?.synapses ?? [])) {
      const key = synapseKey(row.fromUuid, row.toUuid);
      const share = Number(row.share);
      shareByEdge.set(
        key,
        (shareByEdge.get(key) ?? 0) + (Number.isFinite(share) ? share : 0),
      );
    }
  }

  // 4. Per-neuron impact. Exported impacts win; anything missing (inputs, in
  //    particular) is propagated back from the outputs through the allocation
  //    shares, walking layers in descending order.
  const exportedImpacts = snapshot?.derived?.impactsByNeuronUuid ?? {};
  /** @type {Map<string, Set<string>>} */
  const outgoingTargets = new Map();
  for (const s of keptSynapses) {
    if (!outgoingTargets.has(s.fromUuid)) {
      outgoingTargets.set(s.fromUuid, new Set());
    }
    outgoingTargets.get(s.fromUuid).add(s.toUuid);
  }
  /** @type {Map<string, number>} */
  const impactByUuid = new Map();
  for (const uuid of kept) {
    const value = exportedImpacts?.[uuid];
    if (typeof value === "number" && Number.isFinite(value)) {
      impactByUuid.set(uuid, value);
    }
  }
  for (const uuid of keptOutputs) {
    if (!impactByUuid.has(uuid)) impactByUuid.set(uuid, 1);
  }
  const byLayerDescending = kept.slice().sort((a, b) =>
    (layerByUuid.get(b) ?? 0) - (layerByUuid.get(a) ?? 0) || compareUuid(a, b)
  );
  for (const uuid of byLayerDescending) {
    if (impactByUuid.has(uuid)) continue;
    let sum = 0;
    for (const to of (outgoingTargets.get(uuid) ?? [])) {
      const share = shareByEdge.get(synapseKey(uuid, to)) ?? 0;
      sum += share * (impactByUuid.get(to) ?? 0);
    }
    impactByUuid.set(uuid, sum);
  }

  // 5. Families for the inputs.
  const families = groupObservationsByFamily({
    uuids: keptInputs,
    labels,
    groups,
    deriveFamily,
  });

  // 6. Map every kept neuron to its aggregate node id.
  /** @type {Map<string, string>} */
  const aggregateIdByUuid = new Map();
  for (const family of families) {
    for (const member of family.members) {
      aggregateIdByUuid.set(member, `family:${family.key}`);
    }
  }
  for (const uuid of keptOutputs) aggregateIdByUuid.set(uuid, `neuron:${uuid}`);

  let strongestHidden = 0;
  for (const uuid of keptHidden) {
    strongestHidden = Math.max(
      strongestHidden,
      Math.abs(impactByUuid.get(uuid) ?? 0),
    );
  }
  const cutoff = strongestHidden * collapseThreshold;
  let collapsedNeuronCount = 0;
  for (const uuid of keptHidden) {
    const impact = Math.abs(impactByUuid.get(uuid) ?? 0);
    const keepIndividually = collapseThreshold <= 0 || impact >= cutoff;
    if (keepIndividually) {
      aggregateIdByUuid.set(uuid, `neuron:${uuid}`);
    } else {
      aggregateIdByUuid.set(
        uuid,
        `collapsed:layer-${layerByUuid.get(uuid) ?? 0}`,
      );
      collapsedNeuronCount += 1;
    }
  }

  // 7. Aggregate nodes.
  /** @type {Map<string, AggregateNode>} */
  const nodesById = new Map();
  function upsertNode(id, kind, layer, label) {
    let node = nodesById.get(id);
    if (!node) {
      node = {
        id,
        kind,
        label,
        layer,
        members: [],
        memberCount: 0,
        impact: 0,
        outputShares: [],
      };
      nodesById.set(id, node);
    }
    return node;
  }
  for (const family of families) {
    const node = upsertNode(`family:${family.key}`, "family", 0, family.label);
    node.members = family.members.slice();
    node.memberCount = node.members.length;
    node.impact = node.members.reduce(
      (acc, uuid) => acc + (impactByUuid.get(uuid) ?? 0),
      0,
    );
  }
  for (const uuid of keptOutputs.concat(keptHidden).sort(compareUuid)) {
    const id = aggregateIdByUuid.get(uuid);
    const layer = layerByUuid.get(uuid) ?? 0;
    const isCollapsed = id.startsWith("collapsed:");
    const node = upsertNode(
      id,
      isCollapsed ? "collapsed" : "neuron",
      layer,
      isCollapsed ? "" : (labels?.[uuid] ?? uuid),
    );
    node.members.push(uuid);
    node.memberCount = node.members.length;
    node.impact += impactByUuid.get(uuid) ?? 0;
  }
  for (const node of nodesById.values()) {
    if (node.kind !== "collapsed") continue;
    node.members.sort(compareUuid);
    node.label = `${node.memberCount} low-impact neurons`;
  }

  // 8. Aggregate edges. Synapses whose endpoints land in the same aggregate
  //    node become internal to that node and are counted, not rendered.
  /** @type {Map<string, AggregateEdge>} */
  const edgesById = new Map();
  let selfEdgeCount = 0;
  for (const s of keptSynapses) {
    const from = aggregateIdByUuid.get(s.fromUuid);
    const to = aggregateIdByUuid.get(s.toUuid);
    if (!from || !to) continue;
    if (from === to) {
      selfEdgeCount += 1;
      continue;
    }
    const id = `${from}=>${to}`;
    let edge = edgesById.get(id);
    if (!edge) {
      edge = {
        id,
        from,
        to,
        weight: 0,
        absWeight: 0,
        impact: 0,
        members: [],
        memberCount: 0,
      };
      edgesById.set(id, edge);
    }
    const key = synapseKey(s.fromUuid, s.toUuid);
    edge.weight += s.weight;
    edge.absWeight += Math.abs(s.weight);
    edge.impact += (shareByEdge.get(key) ?? 0) *
      (impactByUuid.get(s.toUuid) ?? 0);
    edge.members.push(key);
  }
  const edges = Array.from(edgesById.values()).sort((a, b) =>
    compareText(a.from, b.from) || compareText(a.to, b.to)
  );
  for (const edge of edges) {
    edge.members.sort(compareText);
    edge.memberCount = edge.members.length;
  }

  const nodes = Array.from(nodesById.values()).sort((a, b) =>
    a.layer - b.layer || compareText(a.id, b.id)
  );

  // 9. Per-node output attribution over the *aggregated* graph. Path
  //    enumeration is only affordable while the aggregate is small, so the
  //    budget is reported in meta rather than silently truncating.
  const outputNodeIds = Array.from(
    new Set(keptOutputs.map((uuid) => aggregateIdByUuid.get(uuid))),
  ).sort(compareText);
  const outputNodeIdSet = new Set(outputNodeIds);
  const outputSharesComputed = outputNodeIds.length > 0 &&
    nodes.length <= maxAttributionNodes;
  if (outputSharesComputed) {
    const aggregateSynapses = edges.map((e) => ({
      fromUuid: e.from,
      toUuid: e.to,
      weight: e.absWeight,
    }));
    for (const node of nodes) {
      if (outputNodeIdSet.has(node.id)) continue;
      const breakdown = computeImpactBreakdownToOutputs({
        startUuid: node.id,
        synapses: aggregateSynapses,
        outputUuids: outputNodeIds,
        maxDepth,
        maxPaths,
      });
      node.outputShares = breakdown.outputs
        .map((o) => ({ nodeId: o.outputUuid, share: o.share }))
        .sort((a, b) => b.share - a.share || compareText(a.nodeId, b.nodeId));
    }
  }

  const layers = [];
  for (let index = 0; index < layerCount; index++) {
    layers.push({
      index,
      nodeIds: nodes.filter((n) => n.layer === index).map((n) => n.id),
    });
  }

  return {
    nodes,
    edges,
    layers,
    families,
    meta: {
      collapseThreshold,
      maxAttributionNodes,
      neuronCount: neuronsByUuid.size,
      synapseCount: synapses.length,
      keptNeuronCount: kept.length,
      droppedNeuronCount: neuronsByUuid.size - kept.length,
      collapsedNeuronCount,
      selfEdgeCount,
      layerCount,
      outputNodeIds,
      outputSharesComputed,
    },
  };
}
