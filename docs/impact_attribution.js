/**
 * Impact attribution helpers (heuristic).
 *
 * This viewer consumes `derived.impactsByNeuronUuid` from the snapshot. That
 * impact is a *per-neuron* metric, not a per-synapse one.
 *
 * When a neuron fans out (multiple downstream paths to one or more outputs),
 * users naturally want to know "where does this impact go?".
 *
 * The snapshot format does not currently provide exact per-path impact
 * decomposition, so we provide a deterministic, explainable heuristic:
 *
 * - Enumerate acyclic forward paths from `startUuid` to each output neuron.
 * - Score each path by the product of absolute weights: \(\prod |w|\).
 * - Aggregate scores per output, normalise, and (optionally) allocate the
 *   neuron's impact proportionally across outputs.
 *
 * This makes the "combined impact" behaviour visible without pretending that
 * inbound synapse rows are additive.
 */

/**
 * @typedef {{ fromUuid: string, toUuid: string, weight: number }} Synapse
 */

/**
 * @typedef {{
 *   startUuid: string,
 *   synapses: Synapse[],
 *   outputUuids: string[],
 *   neuronImpact?: number | null,
 *   collectPaths?: boolean,
 *   maxDepth?: number,
 *   maxPaths?: number,
 *   topPathsPerOutput?: number
 * }} ImpactBreakdownInput
 */

/**
 * @typedef {{ fromUuid: string, toUuid: string, weight: number }} PathStep
 */

/**
 * @typedef {{ nodes: string[], steps: PathStep[], score: number }} ScoredPath
 */

/**
 * @typedef {{
 *   outputUuid: string,
 *   score: number,
 *   share: number,
 *   allocatedImpact: number | null,
 *   pathCount: number,
 *   topPaths: ScoredPath[]
 *   paths?: ScoredPath[]
 * }} OutputBreakdown
 */

/**
 * @typedef {{
 *   startUuid: string,
 *   outputs: OutputBreakdown[],
 *   totalScore: number,
 *   totalPathsEnumerated: number,
 *   truncated: boolean,
 *   maxDepth: number,
 *   maxPaths: number
 * }} ImpactBreakdownResult
 */

/**
 * Compute an "impact to outputs" breakdown for a neuron.
 *
 * Notes:
 * - Cycles are avoided by refusing to revisit nodes already on the current path.
 * - Enumeration is bounded by `maxDepth` and `maxPaths` to keep the UI snappy.
 *
 * @param {ImpactBreakdownInput} input
 * @returns {ImpactBreakdownResult}
 */
export function computeImpactBreakdownToOutputs(input) {
  const {
    startUuid,
    synapses,
    outputUuids,
    neuronImpact = null,
    collectPaths = false,
    maxDepth = 10,
    maxPaths = 2500,
    topPathsPerOutput = 3,
  } = input ?? {};

  if (!startUuid || !Array.isArray(synapses) || !Array.isArray(outputUuids)) {
    return {
      startUuid: startUuid ?? "",
      outputs: [],
      totalScore: 0,
      totalPathsEnumerated: 0,
      truncated: false,
      maxDepth,
      maxPaths,
    };
  }

  const outputSet = new Set(outputUuids);

  /** @type {Map<string, Synapse[]>} */
  const outgoing = new Map();
  for (const s of synapses) {
    if (!s || typeof s.fromUuid !== "string" || typeof s.toUuid !== "string") {
      continue;
    }
    if (typeof s.weight !== "number" || !isFinite(s.weight)) continue;
    if (!outgoing.has(s.fromUuid)) outgoing.set(s.fromUuid, []);
    outgoing.get(s.fromUuid).push(s);
  }

  /** @type {Map<string, {score: number, pathCount: number, topPaths: ScoredPath[], paths?: ScoredPath[]}>} */
  const byOutput = new Map();
  for (const out of outputSet) {
    byOutput.set(
      out,
      collectPaths
        ? { score: 0, pathCount: 0, topPaths: [], paths: [] }
        : { score: 0, pathCount: 0, topPaths: [] },
    );
  }

  let truncated = false;
  let totalPathsEnumerated = 0;

  /**
   * @param {string} outputUuid
   * @param {string[]} nodes
   * @param {PathStep[]} steps
   * @param {number} score
   */
  function recordPath(outputUuid, nodes, steps, score) {
    const agg = byOutput.get(outputUuid);
    if (!agg) return;

    agg.score += score;
    agg.pathCount += 1;

    // Maintain a small "top N" list by path score.
    agg.topPaths.push({ nodes, steps, score });
    agg.topPaths.sort((a, b) => b.score - a.score);
    if (agg.topPaths.length > topPathsPerOutput) {
      agg.topPaths.length = topPathsPerOutput;
    }

    if (collectPaths) {
      // Bounded by the global enumeration safety limits; store in encounter order.
      agg.paths?.push({ nodes, steps, score });
    }
  }

  /**
   * Depth-first enumeration of acyclic forward paths.
   *
   * @param {string} node
   * @param {string[]} nodes
   * @param {PathStep[]} steps
   * @param {Set<string>} seenOnPath
   * @param {number} score
   * @param {number} depth
   */
  function dfs(node, nodes, steps, seenOnPath, score, depth) {
    if (truncated) return;
    if (depth > maxDepth) return;

    // A zero-length path to itself shouldn't count as "path to output" unless
    // the start itself is an output neuron.
    if ((depth > 0 || outputSet.has(startUuid)) && outputSet.has(node)) {
      totalPathsEnumerated += 1;
      if (totalPathsEnumerated > maxPaths) {
        truncated = true;
        return;
      }
      recordPath(node, nodes, steps, score);
      return;
    }

    const outs = outgoing.get(node);
    if (!outs || outs.length === 0) return;

    for (const s of outs) {
      const next = s.toUuid;
      if (seenOnPath.has(next)) continue; // avoid cycles

      const nextScore = score * Math.abs(s.weight);
      const nextNodes = nodes.concat([next]);
      const nextSteps = steps.concat([{
        fromUuid: s.fromUuid,
        toUuid: s.toUuid,
        weight: s.weight,
      }]);
      const nextSeen = new Set(seenOnPath);
      nextSeen.add(next);

      dfs(next, nextNodes, nextSteps, nextSeen, nextScore, depth + 1);
      if (truncated) return;
    }
  }

  dfs(startUuid, [startUuid], [], new Set([startUuid]), 1, 0);

  let totalScore = 0;
  for (const { score } of byOutput.values()) totalScore += score;

  /** @type {OutputBreakdown[]} */
  const outputs = [];
  if (totalScore > 0) {
    for (const [outputUuid, agg] of byOutput.entries()) {
      if (agg.pathCount <= 0) continue;
      const share = agg.score / totalScore;
      const out = {
        outputUuid,
        score: agg.score,
        share,
        allocatedImpact:
          typeof neuronImpact === "number" && isFinite(neuronImpact)
            ? neuronImpact * share
            : null,
        pathCount: agg.pathCount,
        topPaths: agg.topPaths,
      };
      if (collectPaths) out.paths = agg.paths ?? [];
      outputs.push(out);
    }
  }

  outputs.sort((a, b) => b.score - a.score);

  return {
    startUuid,
    outputs,
    totalScore,
    totalPathsEnumerated: Math.min(totalPathsEnumerated, maxPaths),
    truncated,
    maxDepth,
    maxPaths,
  };
}

/**
 * Inbound synapse impact allocation (heuristic).
 *
 * Problem:
 * - Snapshots provide a per-neuron `impact`, but the UI shows inbound synapses.
 * - Users want to understand "how does this neuron's impact relate to each
 *   inbound synapse?" (in terms of the current neuron).
 *
 * Heuristic:
 * - For each inbound synapse (from -> to), compute a local attribution score:
 *     score = |meanContribution|  (preferred when available)
 *     fallback: |weight|
 * - Allocate the neuron's impact across inbound synapses proportionally:
 *     allocatedImpact_i = neuronImpact * score_i / Σ score
 *
 * Squash-aware cap (issue #270)
 * -----------------------------
 * A neuron's activation cannot exceed what its squash function can emit
 * (TANH: ±1, SIGMOID: 0..1, etc). When `toNeuronSquash` is supplied, the
 * allocation rescales the per-synapse `allocatedImpact` such that the sum
 * never exceeds the squash emit ceiling. Concretely, when the raw Σ score
 * would saturate the receiving neuron, each synapse's allocated influence
 * collapses to a fair share of the ceiling: ten synapses each feeding 10
 * into a TANH neuron contribute ~0.1 each, summing to ≤ 1.0.
 *
 * For unbounded squashes (RELU/IDENTITY) callers may pass
 * `recordedActivationMax` to provide an observed envelope; otherwise the
 * helper falls back to current behaviour (no cap).
 *
 * Unknown or missing squash strings fall back gracefully — no console
 * output, the cap is simply skipped.
 *
 * This creates an explainable breakdown where the allocated impacts sum to the
 * neuron's impact (within rounding) and are bounded by what the receiving
 * neuron can actually emit, without claiming it's ground-truth.
 */

import { squashEmitCeiling } from "./shared/squash_bounds.js";

/**
 * @typedef {{
 *   fromUuid: string,
 *   toUuid: string,
 *   weight: number,
 *   meanContribution?: number | null
 * }} InboundSynapseWithStats
 */

/**
 * @typedef {{
 *   toUuid: string,
 *   neuronImpact: number | null,
 *   totalScore: number,
 *   emitCeiling: number,
 *   synapses: Array<InboundSynapseWithStats & {
 *     score: number,
 *     share: number,
 *     allocatedImpact: number | null
 *   }>
 * }} InboundAllocationResult
 */

/**
 * @param {{
 *   toUuid: string,
 *   neuronImpact?: number | null,
 *   inboundSynapses: InboundSynapseWithStats[],
 *   toNeuronSquash?: string | null,
 *   recordedActivationMax?: number | null
 * }} input
 * @returns {InboundAllocationResult}
 */
export function computeInboundSynapseImpactAllocation(input) {
  const {
    toUuid,
    neuronImpact = null,
    inboundSynapses,
    toNeuronSquash = null,
    recordedActivationMax = null,
  } = input ?? {};
  if (!toUuid || !Array.isArray(inboundSynapses)) {
    return {
      toUuid: toUuid ?? "",
      neuronImpact: neuronImpact ?? null,
      totalScore: 0,
      emitCeiling: Number.POSITIVE_INFINITY,
      synapses: [],
    };
  }

  const rows = inboundSynapses
    .filter((s) =>
      s && typeof s.fromUuid === "string" && typeof s.toUuid === "string" &&
      typeof s.weight === "number" && isFinite(s.weight)
    )
    .map((s) => {
      const mc = s.meanContribution;
      const score = typeof mc === "number" && isFinite(mc)
        ? Math.abs(mc)
        : Math.abs(s.weight);
      return { ...s, score };
    });

  const totalScore = rows.reduce(
    (acc, r) => acc + (isFinite(r.score) ? r.score : 0),
    0,
  );

  const emitCeiling = squashEmitCeiling(
    toNeuronSquash,
    typeof recordedActivationMax === "number" ? recordedActivationMax : null,
  );
  const haveFiniteCeiling = isFinite(emitCeiling) && emitCeiling > 0;

  const synapses = rows.map((r) => {
    const share = totalScore > 0 ? r.score / totalScore : 0;

    let allocatedImpact = null;
    if (
      typeof neuronImpact === "number" && isFinite(neuronImpact) &&
      totalScore > 0
    ) {
      // Preserve the sign of neuronImpact, but cap its magnitude at the
      // squash emit ceiling so the sum can never exceed what the neuron can
      // actually output.
      const mag = Math.abs(neuronImpact);
      const cappedMag = haveFiniteCeiling ? Math.min(mag, emitCeiling) : mag;
      const sign = neuronImpact < 0 ? -1 : 1;
      allocatedImpact = sign * cappedMag * share;
    } else if (haveFiniteCeiling && totalScore > 0) {
      // No neuronImpact provided, but we know the receiving neuron's emit
      // ceiling: report each synapse's bounded influence (fair-share rescaled
      // when the raw Σ score would saturate the neuron).
      allocatedImpact = Math.min(totalScore, emitCeiling) * share;
    }

    return { ...r, share, allocatedImpact };
  }).sort((a, b) =>
    (b.allocatedImpact ?? b.score) - (a.allocatedImpact ?? a.score)
  );

  return {
    toUuid,
    neuronImpact: neuronImpact ?? null,
    totalScore,
    emitCeiling,
    synapses,
  };
}
