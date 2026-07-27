/**
 * Top-impact subgraph model (Issue #527).
 *
 * The third candidate replacement for the 3D starfield. Where the layered DAG
 * view (Issue #525) aggregates the *whole* network, this model shows only the
 * highest-contributing paths to the Score and states, explicitly, how much of
 * the network it left out.
 *
 * Two stages, split so the expensive half runs once per snapshot while the
 * N / threshold control re-runs only the cheap half:
 *
 *  1. `buildSubgraphSource` — aggregate the network (`aggregated_graph_model.js`,
 *     which supplies family grouping, layers and per-node/per-edge impact) and
 *     rank every observation by its squash-aware contribution to the output
 *     (`computeTopContributingInputs` in `graph_analysis.js`). Neither result
 *     depends on the control, so both are computed once.
 *  2. `extractTopImpactSubgraph` — take the top N ranked paths that clear the
 *     impact threshold, and carve the matching nodes and edges out of the
 *     aggregated model.
 *
 * The result is shaped like an aggregated graph model, so it renders through
 * the shared layered layout (`dag_layout.js`) with the same impact-encoded
 * nodes/edges and the same observation-summary tooltips as Issue #521.
 *
 * Dead zones are first-class: every neuron, node and observation the subgraph
 * excludes is counted, so "not shown" is never confused with "not there".
 *
 * @example
 * const source = buildSubgraphSource(snapshot);
 * const subgraph = extractTopImpactSubgraph(source, { topPaths: 12 });
 * container.innerHTML = dagLayoutToSvgString(computeDagLayout(subgraph));
 *
 * @module
 */

import { buildAggregatedGraphModel } from "./aggregated_graph_model.js";
import { computeTopContributingInputs } from "./graph_analysis.js";
import { normaliseCreature } from "./snapshot_loader.js";
import { buildObservationTooltip } from "./ui_helpers.js";

/** Paths drawn by default — enough to explain the Score, few enough to read. */
export const DEFAULT_TOP_PATHS = 12;

/** Paths carrying less than 0.5% of the Score are noise by default. */
export const DEFAULT_IMPACT_THRESHOLD = 0.005;

/** Depth and work caps for the upstream attribution walk. */
const DEFAULT_MAX_DEPTH = 24;
const DEFAULT_MAX_WORK = 60000;

/** Key used for `derived.synapses` lookups. */
function synapseKey(fromUuid, toUuid) {
  return `${fromUuid}→${toUuid}`;
}

/** Coerce to a finite number, falling back to 0. */
function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * @typedef {object} SubgraphPath
 * @property {string} inputUuid — the observation the path starts at.
 * @property {number} score — share of the Score carried, 0..1.
 * @property {string[]} path — raw neuron uuids, observation → … → output.
 * @property {string[]} nodeIds — the same path mapped onto aggregate node ids.
 * @property {number} hops — number of synapses traversed.
 */

/**
 * Prepare everything the subgraph extraction needs from a snapshot.
 *
 * Throws when the snapshot carries no creature, and when no observation can be
 * attributed to any output — both are faults to surface, not empty diagrams to
 * render.
 *
 * @param {unknown} snapshot — raw snapshot JSON.
 * @param {{
 *   collapseThreshold?: number,
 *   deriveFamily?: Function|null,
 *   maxDepth?: number,
 *   maxWork?: number,
 * }} [options]
 * @returns {{
 *   model: ReturnType<typeof buildAggregatedGraphModel>,
 *   rankedPaths: SubgraphPath[],
 *   nodeIdByUuid: Map<string, string>,
 *   outputUuids: string[],
 *   truncated: boolean,
 * }}
 */
export function buildSubgraphSource(snapshot, options = {}) {
  const {
    collapseThreshold = 0,
    deriveFamily = null,
    maxDepth = DEFAULT_MAX_DEPTH,
    maxWork = DEFAULT_MAX_WORK,
  } = options ?? {};

  // Fails loudly when the snapshot has no creature.
  const model = buildAggregatedGraphModel(snapshot, {
    collapseThreshold,
    deriveFamily,
  });
  const { neuronsByUuid, synapses } = normaliseCreature(snapshot);

  /** @type {Map<string, string>} */
  const nodeIdByUuid = new Map();
  for (const node of model.nodes) {
    for (const uuid of node.members) nodeIdByUuid.set(uuid, node.id);
  }

  const outputUuids = [];
  for (const id of model.meta.outputNodeIds ?? []) {
    const node = model.nodes.find((n) => n.id === id);
    for (const uuid of (node?.members ?? [])) outputUuids.push(uuid);
  }
  if (outputUuids.length === 0) {
    throw new Error(
      "buildSubgraphSource: the snapshot declares no output neuron — there is no Score to attribute to",
    );
  }

  // Inbound synapses, carrying the recorded contribution statistics so the
  // walk's allocation can apply selection-squash attribution (Issue #513).
  const derivedSynapses = snapshot?.derived?.synapses ?? {};
  /** @type {Map<string, Array<object>>} */
  const inboundByTo = new Map();
  for (const s of synapses) {
    const stats = derivedSynapses?.[synapseKey(s.fromUuid, s.toUuid)];
    if (!inboundByTo.has(s.toUuid)) inboundByTo.set(s.toUuid, []);
    inboundByTo.get(s.toUuid).push({
      fromUuid: s.fromUuid,
      toUuid: s.toUuid,
      weight: s.weight,
      meanContribution: stats?.stats?.meanContribution ?? null,
      contributions: Array.isArray(stats?.contribution)
        ? stats.contribution
        : null,
    });
  }

  const recordedMax = snapshot?.derived?.activationMaxByNeuronUuid ?? {};

  /** @type {Map<string, { score: number, path: string[] }>} */
  const bestByInput = new Map();
  let truncated = false;
  for (const outputUuid of outputUuids) {
    const walk = computeTopContributingInputs({
      focusUuid: outputUuid,
      getInboundEdges: (uuid) => inboundByTo.get(uuid) ?? [],
      getNeuronSquash: (uuid) => neuronsByUuid.get(uuid)?.squash ?? null,
      getRecordedActivationMax: (uuid) => recordedMax?.[uuid] ?? null,
      exhaustive: true,
      maxDepth,
      maxWork,
    });
    truncated = truncated || walk.truncated === true;
    for (const row of walk.inputs) {
      const score = finite(row.score);
      if (score <= 0) continue;
      const existing = bestByInput.get(row.uuid);
      // Multiple outputs: an observation's contribution is the sum across
      // outputs, illustrated by whichever path carried the most.
      if (!existing) {
        bestByInput.set(row.uuid, {
          score,
          best: score,
          path: row.path.slice(),
        });
      } else {
        existing.score += score;
        if (score > existing.best) {
          existing.best = score;
          existing.path = row.path.slice();
        }
      }
    }
  }

  if (bestByInput.size === 0) {
    throw new Error(
      `buildSubgraphSource: no observation contributes to the output (${
        outputUuids.join(", ")
      }) — the network cannot be explained`,
    );
  }

  // Re-normalise so the reported shares sum to 1 across every output.
  let total = 0;
  for (const entry of bestByInput.values()) total += entry.score;
  if (total <= 0) total = 1;

  /** @type {SubgraphPath[]} */
  const rankedPaths = Array.from(bestByInput.entries())
    .map(([inputUuid, entry]) => {
      const path = entry.path;
      /** @type {string[]} */
      const nodeIds = [];
      for (const uuid of path) {
        const id = nodeIdByUuid.get(uuid);
        if (!id) continue;
        if (nodeIds[nodeIds.length - 1] === id) continue;
        nodeIds.push(id);
      }
      return {
        inputUuid,
        score: entry.score / total,
        path: path.slice(),
        nodeIds,
        hops: Math.max(0, path.length - 1),
      };
    })
    .sort((a, b) =>
      b.score - a.score ||
      (a.inputUuid < b.inputUuid ? -1 : a.inputUuid > b.inputUuid ? 1 : 0)
    );

  return { model, rankedPaths, nodeIdByUuid, outputUuids, truncated };
}

/** True when `value` already looks like a prepared subgraph source. */
function isSource(value) {
  return Boolean(value) && Array.isArray(value?.rankedPaths) &&
    Boolean(value?.model);
}

/**
 * Carve the top-impact subgraph out of a prepared source.
 *
 * The result is shaped like an aggregated graph model — `nodes`, `edges`,
 * `layers`, `families`, `meta` — so `computeDagLayout` renders it unchanged,
 * plus the ranked `paths` that produced it and the `deadZone` summary of
 * everything left out.
 *
 * An empty result is a legitimate control setting (the threshold excluded
 * every path), not a fault: it is reported with the whole network in the dead
 * zone rather than thrown or silently widened.
 *
 * @param {object|unknown} sourceOrSnapshot — from `buildSubgraphSource`, or a
 *   raw snapshot (which is prepared on the spot).
 * @param {{ topPaths?: number, impactThreshold?: number }} [options]
 * @returns {{
 *   nodes: object[],
 *   edges: object[],
 *   layers: Array<{ index: number, nodeIds: string[] }>,
 *   families: object[],
 *   paths: SubgraphPath[],
 *   deadZone: Record<string, number>,
 *   meta: Record<string, unknown>,
 * }}
 */
export function extractTopImpactSubgraph(sourceOrSnapshot, options = {}) {
  const {
    topPaths = DEFAULT_TOP_PATHS,
    impactThreshold = DEFAULT_IMPACT_THRESHOLD,
  } = options ?? {};

  const source = isSource(sourceOrSnapshot)
    ? sourceOrSnapshot
    : buildSubgraphSource(sourceOrSnapshot);
  const { model, rankedPaths } = source;

  const limit = Math.max(0, Math.floor(topPaths));
  const paths = rankedPaths
    .filter((p) => p.score >= impactThreshold)
    .slice(0, limit);

  /** @type {Set<string>} */
  const keptNodeIds = new Set();
  /** @type {Set<string>} */
  const keptEdgeIds = new Set();
  /** @type {Set<string>} */
  const keptUuids = new Set();
  for (const path of paths) {
    for (const uuid of path.path) keptUuids.add(uuid);
    for (let i = 0; i < path.nodeIds.length; i++) {
      keptNodeIds.add(path.nodeIds[i]);
      if (i > 0) keptEdgeIds.add(`${path.nodeIds[i - 1]}=>${path.nodeIds[i]}`);
    }
  }

  const kept = model.nodes.filter((n) => keptNodeIds.has(n.id));
  const edges = model.edges.filter((e) => keptEdgeIds.has(e.id));

  // Compact the layers: the subgraph typically spans a handful of the original
  // network's layers, and empty columns would stretch the diagram for nothing.
  const usedLayers = Array.from(new Set(kept.map((n) => finite(n.layer))))
    .sort((a, b) => a - b);
  const denseLayerByOriginal = new Map(
    usedLayers.map((layer, index) => [layer, index]),
  );
  const nodes = kept.map((node) => ({
    ...node,
    layer: denseLayerByOriginal.get(finite(node.layer)) ?? 0,
  }));

  const layers = usedLayers.map((_original, index) => ({
    index,
    nodeIds: nodes.filter((n) => n.layer === index).map((n) => n.id),
  }));

  const outputNodeIds = (model.meta.outputNodeIds ?? [])
    .filter((id) => keptNodeIds.has(id));

  // Dead zones: everything the subgraph excludes, counted three ways so the
  // view can say exactly what is not on screen.
  const totalNeurons = finite(model.meta.neuronCount);
  const totalObservations = model.families.reduce(
    (acc, f) => acc + finite(f.memberCount),
    0,
  );
  const subgraphObservations = paths.length;
  const deadZone = {
    totalNodes: model.nodes.length,
    subgraphNodes: nodes.length,
    excludedNodes: model.nodes.length - nodes.length,
    totalNeurons,
    subgraphNeurons: keptUuids.size,
    excludedNeurons: totalNeurons - keptUuids.size,
    totalObservations,
    subgraphObservations,
    excludedObservations: totalObservations - subgraphObservations,
    unreachableNeurons: finite(model.meta.droppedNeuronCount),
  };

  return {
    nodes,
    edges,
    layers,
    families: model.families,
    paths,
    deadZone,
    meta: {
      ...model.meta,
      outputNodeIds,
      layerCount: Math.max(1, usedLayers.length),
      topPaths: limit,
      impactThreshold,
      rankedPathCount: rankedPaths.length,
      walkTruncated: source.truncated === true,
    },
  };
}

/** Format a 0..1 share as a percentage with one decimal place. */
function formatShare(share) {
  return `${(finite(share) * 100).toFixed(1)}%`;
}

/**
 * Describe one extracted path in plain text — the drill-down that answers
 * "why is this observation moving the Score?".
 *
 * The observation summary comes from `buildObservationTooltip`, so the wording
 * matches the tooltips every other view shows (Issue #521).
 *
 * @param {{
 *   inputUuid?: string,
 *   score?: number,
 *   path?: string[],
 *   hops?: number,
 * }} path
 * @param {{
 *   labels?: Record<string, string>,
 *   descriptions?: Record<string, string>,
 * }} [tooltips]
 * @returns {string} multi-line description.
 */
export function describeSubgraphPath(path, tooltips = {}) {
  const { labels = {}, descriptions = {} } = tooltips ?? {};
  const uuid = path?.inputUuid ?? "";
  const chain = Array.isArray(path?.path) ? path.path : [];
  const hops = Number.isFinite(path?.hops)
    ? path.hops
    : Math.max(0, chain.length - 1);

  return [
    buildObservationTooltip({
      uuid,
      label: labels[uuid] ?? null,
      description: descriptions[uuid] ?? null,
    }),
    `${formatShare(path?.score)} of the Score · ${hops} ${
      hops === 1 ? "hop" : "hops"
    }`,
    chain.join(" → "),
  ].filter((line) => line.length > 0).join("\n");
}

/**
 * Legend markup for the subgraph view — mirrors the encodings the shared
 * layered layout draws, plus the dead zone this view deliberately omits.
 *
 * @returns {string}
 */
export function subgraphLegendHtml() {
  return `<dl class="dagLegend" aria-label="Diagram legend">` +
    `<div class="dagLegendRow"><dt>Shown</dt>` +
    `<dd>only the top-impact paths to the Score</dd></div>` +
    `<div class="dagLegendRow"><dt>Columns</dt>` +
    `<dd>observations → hidden layers → output</dd></div>` +
    `<div class="dagLegendRow"><dt>Node size &amp; intensity</dt>` +
    `<dd>impact on the Score (log)</dd></div>` +
    `<div class="dagLegendRow"><dt>Link width</dt>` +
    `<dd>contribution carried by the merged synapses (log)</dd></div>` +
    `<div class="dagLegendRow"><dt>Link colour</dt>` +
    `<dd>sum of weights (red negative → blue positive)</dd></div>` +
    `<div class="dagLegendRow"><dt>Dead zone</dt>` +
    `<dd>everything excluded from the subgraph — counted in the summary</dd>` +
    `</div>` +
    `</dl>`;
}
