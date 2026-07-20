/**
 * Graph analysis helpers for NEAT-AI Explore.
 *
 * These are intentionally DOM-free so they can be unit-tested with Deno and
 * reused across views.
 *
 * Squash-aware upstream attribution (issue #270)
 * ----------------------------------------------
 * Per-synapse contributions are bounded by what the receiving neuron's squash
 * can emit. The multi-hop walk in `computeTopContributingInputs` propagates
 * this cap by passing each intermediate neuron's squash (and optional
 * recorded activation envelope) to `computeInboundSynapseImpactAllocation`.
 * The allocation rescales contributions to:
 *
 *     bounded_i = share_i · min(Σ score, emitCeiling)
 *
 * where `emitCeiling = squashEmitCeiling(squash, recordedActivationMax)`. The
 * walk then propagates upstream using `share` (unchanged for normalised
 * traversal), and the accumulated contribution at any intermediate neuron can
 * never exceed that neuron's emit ceiling.
 *
 * Australian English note:
 * - Prefer spellings like \"behaviour\" and \"organisation\".
 *
 * Last updated: 20260527
 */

import { computeInboundSynapseImpactAllocation } from "../impact_attribution.js";
import { computeInputActiveFraction } from "./consumer_contract.js";

/**
 * @typedef {{ fromUuid: string, toUuid: string, weight: number, meanContribution?: number|null, contributions?: number[]|null }} Edge
 */

/**
 * Build adjacency indices for a directed synapse graph.
 *
 * @param {Array<{ fromUuid: string, toUuid: string }>} synapses
 * @returns {{
 *   incomingByTo: Map<string, string[]>,
 *   outgoingByFrom: Map<string, string[]>,
 * }}
 */
export function buildGraphIndex(synapses) {
  /** @type {Map<string, string[]>} */
  const incomingByTo = new Map();
  /** @type {Map<string, string[]>} */
  const outgoingByFrom = new Map();

  for (const s of (Array.isArray(synapses) ? synapses : [])) {
    const from = s?.fromUuid;
    const to = s?.toUuid;
    if (!from || !to) continue;

    if (!incomingByTo.has(to)) incomingByTo.set(to, []);
    incomingByTo.get(to).push(from);

    if (!outgoingByFrom.has(from)) outgoingByFrom.set(from, []);
    outgoingByFrom.get(from).push(to);
  }

  return { incomingByTo, outgoingByFrom };
}

/**
 * Compute the set of nodes that can influence any output (reverse reachability).
 *
 * We treat synapses as directed: from -> to.
 * If a node is in the returned set, there exists some path node -> ... -> output.
 *
 * @param {{
 *   outputUuids: string[],
 *   incomingByTo: Map<string, string[]>,
 * }} input
 * @returns {Set<string>}
 */
export function computeReachableToOutputs({ outputUuids, incomingByTo }) {
  /** @type {Set<string>} */
  const reachable = new Set();
  const q = [];
  for (const o of (Array.isArray(outputUuids) ? outputUuids : [])) {
    if (!o) continue;
    reachable.add(o);
    q.push(o);
  }
  while (q.length) {
    const to = q.pop();
    const ins = incomingByTo.get(to);
    if (!ins || ins.length === 0) continue;
    for (const from of ins) {
      if (reachable.has(from)) continue;
      reachable.add(from);
      q.push(from);
    }
  }
  return reachable;
}

/**
 * Bounded upstream attribution walk to find the most influential inputs for a
 * focused neuron.
 *
 * This is designed for *large* creatures: it explores the highest-share inbound
 * branches first and caps work so it remains usable on iPhone.
 *
 * Cycle handling
 * --------------
 * The walk is a best-first traversal upstream from `focusUuid`. Each queued
 * frontier item carries its own `path` array — the chain of neurons from the
 * currently-explored node back up to `focusUuid`. Before enqueuing an inbound
 * predecessor we check whether that predecessor already appears on the
 * current path; if it does, the edge is a back-edge and we skip it.
 *
 * This is equivalent to "visit each `(neuron, depth)` pair on a given walk at
 * most once and skip back-edges": a neuron may still be attributed multiple
 * times along *different* (acyclic) paths — which is what summing
 * contribution share across all upstream paths requires — but a single walk
 * never revisits a neuron it has already passed through. Combined with
 * `maxDepth`, this guarantees termination on any graph, including recurrent
 * networks.
 *
 * Output-neuron callers
 * ---------------------
 * Snapshots typically have a small number of output neurons, so we can
 * afford to be more thorough when the focus is an output. Pass
 * `exhaustive: true` to relax the per-node fan-out cap, the global work cap,
 * the depth cap and the frontier-queue cap. The defaults are kept identical
 * to the previous behaviour for all other callers.
 *
 * @param {{
 *   focusUuid: string,
 *   getInboundEdges: (toUuid: string) => Edge[],
 *   maxDepth?: number,
 *   maxWork?: number,
 *   maxInboundPerNode?: number,
 *   exhaustive?: boolean,
 *   getNeuronSquash?: (uuid: string) => (string | null | undefined),
 *   getRecordedActivationMax?: (uuid: string) => (number | null | undefined),
 *   consumerContract?: (import("./consumer_contract.js").ConsumerContract | null),
 * }} input
 * @returns {{
 *   focusUuid: string,
 *   inputs: Array<{ uuid: string, score: number, path: string[], gateMaskedFraction?: number }>,
 *   truncated: boolean,
 * }}
 */
export function computeTopContributingInputs(input) {
  const focusUuid = input?.focusUuid ?? "";
  const getInboundEdges = input?.getInboundEdges;
  const getNeuronSquash = typeof input?.getNeuronSquash === "function"
    ? input.getNeuronSquash
    : null;
  const getRecordedActivationMax =
    typeof input?.getRecordedActivationMax === "function"
      ? input.getRecordedActivationMax
      : null;
  const consumerContract = input?.consumerContract ?? null;
  const exhaustive = input?.exhaustive === true;
  const maxDepth = Math.max(
    1,
    Math.floor(input?.maxDepth ?? (exhaustive ? 32 : 7)),
  );
  const maxWork = Math.max(
    50,
    Math.floor(input?.maxWork ?? (exhaustive ? 100000 : 1600)),
  );
  const maxInboundPerNode = Math.max(
    5,
    Math.floor(
      input?.maxInboundPerNode ?? (exhaustive ? Number.MAX_SAFE_INTEGER : 40),
    ),
  );
  const queueCap = exhaustive ? 5000 : 300;

  if (!focusUuid || typeof getInboundEdges !== "function") {
    return { focusUuid: focusUuid ?? "", inputs: [], truncated: false };
  }
  if (String(focusUuid).startsWith("input-")) {
    const af = consumerContract
      ? computeInputActiveFraction(consumerContract, focusUuid)
      : 1;
    return {
      focusUuid,
      inputs: [{
        uuid: focusUuid,
        score: af,
        path: [focusUuid],
        gateMaskedFraction: 1 - af,
      }],
      truncated: false,
    };
  }

  /** @type {Map<string, number>} */
  const scoreByInput = new Map();
  /** @type {Map<string, string[]>} */
  const bestPathByInput = new Map();
  /** @type {Map<string, number>} */
  const bestScoreByInput = new Map();
  /** @type {Map<string, number>} */
  const gateMaskedByInput = new Map();

  /** @type {{ uuid: string, score: number, depth: number, path: string[] }[]} */
  const queue = [{ uuid: focusUuid, score: 1, depth: 0, path: [focusUuid] }];
  let work = 0;
  let truncated = false;

  function push(item) {
    queue.push(item);
    // Simple bounded priority queue by score (descending).
    queue.sort((a, b) => b.score - a.score);
    if (queue.length > queueCap) queue.length = queueCap;
  }

  while (queue.length > 0) {
    const cur = queue.shift();
    if (!cur) break;
    work += 1;
    if (work > maxWork) {
      truncated = true;
      break;
    }

    if (cur.score <= 0) continue;
    if (cur.depth >= maxDepth) continue;

    const uuid = cur.uuid;
    if (String(uuid).startsWith("input-")) {
      // Issue #272 — apply downstream min-gate masking at the input boundary.
      // Inputs that only drive the output in a narrow regime contribute the
      // gated fraction of the walk's incoming score.
      const af = consumerContract
        ? computeInputActiveFraction(consumerContract, uuid)
        : 1;
      const credited = cur.score * af;
      const nextScore = (scoreByInput.get(uuid) ?? 0) + credited;
      scoreByInput.set(uuid, nextScore);
      gateMaskedByInput.set(uuid, 1 - af);
      const best = bestScoreByInput.get(uuid) ?? 0;
      if (credited > best) {
        bestScoreByInput.set(uuid, credited);
        bestPathByInput.set(uuid, cur.path);
      }
      continue;
    }

    const inbound = getInboundEdges(uuid) ?? [];
    if (!Array.isArray(inbound) || inbound.length === 0) continue;

    const toNeuronSquash = getNeuronSquash ? getNeuronSquash(uuid) : null;
    const recordedActivationMax = getRecordedActivationMax
      ? getRecordedActivationMax(uuid)
      : null;
    const allocation = computeInboundSynapseImpactAllocation({
      toUuid: uuid,
      neuronImpact: null,
      inboundSynapses: inbound.map((e) => ({
        fromUuid: e.fromUuid,
        toUuid: e.toUuid,
        weight: e.weight,
        meanContribution: e.meanContribution ?? null,
        // Issue #513 — per-observation contribution series lets the allocation
        // apply selection-squash (MINIMUM/MAXIMUM) win-fraction attribution.
        contributions: Array.isArray(e.contributions) ? e.contributions : null,
      })),
      toNeuronSquash: toNeuronSquash ?? null,
      recordedActivationMax: typeof recordedActivationMax === "number"
        ? recordedActivationMax
        : null,
    });

    const steps = (allocation?.synapses ?? [])
      .filter((r) =>
        r && typeof r.share === "number" && isFinite(r.share) && r.share > 0
      )
      .slice(0, maxInboundPerNode);

    for (const s of steps) {
      const nextUuid = s.fromUuid;
      const nextScore = cur.score * (s.share ?? 0);
      if (nextScore <= 0) continue;
      // Skip back-edges: if `nextUuid` is already on this walk's path, the
      // edge would close a cycle. Other walks may still attribute through
      // `nextUuid` along different paths.
      if (cur.path.includes(nextUuid)) continue;
      const nextPath = [nextUuid].concat(cur.path);
      push({
        uuid: nextUuid,
        score: nextScore,
        depth: cur.depth + 1,
        path: nextPath,
      });
    }
  }

  const inputs = Array.from(scoreByInput.entries())
    .map(([uuid, score]) => ({
      uuid,
      score,
      path: bestPathByInput.get(uuid) ?? [uuid],
      gateMaskedFraction: gateMaskedByInput.get(uuid) ?? 0,
    }))
    .sort((a, b) => b.score - a.score);

  // Normalise for display so reported shares sum to ~1.
  const denom = inputs.reduce((acc, r) => acc + (r.score ?? 0), 0) || 1;
  for (const r of inputs) r.score = r.score / denom;

  return { focusUuid, inputs, truncated };
}
