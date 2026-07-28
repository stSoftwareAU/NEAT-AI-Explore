/**
 * Before/after benchmark for Issue #559.
 *
 * Measures the post-download `buildSubgraphSource` cost — dominated by the
 * exhaustive ranked-contribution walk in `computeTopContributingInputs` — on a
 * real snapshot. It times three things:
 *
 *   before : the pre-#559 exhaustive walk (an embedded faithful copy of the old
 *            uncapped path enumeration), run per output exactly as
 *            `buildSubgraphSource` did (maxDepth 24, maxWork 60000);
 *   after  : the new memoised DAG propagation, same inputs;
 *   full   : the whole `buildSubgraphSource` end-to-end with the new walk.
 *
 * It also asserts the top-ranked observations agree (set and order), so the
 * speed-up is not bought by changing the ranking.
 *
 * Usage:
 *   deno run -A scripts/benchmark_subgraph_559.ts /path/to/snapshot.json
 *
 * The snapshot is not committed to this repo — it lives in NEAT-AI-Snapshot and
 * is published at the `DEFAULT_SNAPSHOT_URL`. Download and gunzip it first, e.g.
 *   curl -s -o s.json.gz https://stsoftwareau.github.io/NEAT-AI-Snapshot/snapshot.json.gz
 *   gunzip s.json.gz
 */

import { normaliseCreature } from "../docs/shared/snapshot_loader.js";
import { computeTopContributingInputs } from "../docs/shared/graph_analysis.js";
import { computeInboundSynapseImpactAllocation } from "../docs/impact_attribution.js";
import { buildSubgraphSource } from "../docs/shared/subgraph_model.js";

type Edge = {
  fromUuid: string;
  toUuid: string;
  weight: number;
  meanContribution?: number | null;
  contributions?: number[] | null;
};

/** Faithful copy of the pre-#559 exhaustive walk (path enumeration). */
function oldExhaustiveWalk(inputArg: {
  focusUuid: string;
  getInboundEdges: (uuid: string) => Edge[];
  getNeuronSquash?: (uuid: string) => string | null;
  getRecordedActivationMax?: (uuid: string) => number | null;
  maxDepth?: number;
  maxWork?: number;
}) {
  const focusUuid = inputArg.focusUuid;
  const getInboundEdges = inputArg.getInboundEdges;
  const getNeuronSquash = inputArg.getNeuronSquash ?? (() => null);
  const getRecordedActivationMax = inputArg.getRecordedActivationMax ??
    (() => null);
  const maxDepth = Math.max(1, Math.floor(inputArg.maxDepth ?? 32));
  const maxWork = Math.max(50, Math.floor(inputArg.maxWork ?? 100000));
  const maxInboundPerNode = Number.MAX_SAFE_INTEGER;
  const queueCap = 5000;

  const scoreByInput = new Map<string, number>();
  const bestPathByInput = new Map<string, string[]>();
  const bestScoreByInput = new Map<string, number>();

  type Item = { uuid: string; score: number; depth: number; path: string[] };
  const queue: Item[] = [{
    uuid: focusUuid,
    score: 1,
    depth: 0,
    path: [focusUuid],
  }];
  let work = 0;
  let truncated = false;

  function push(item: Item) {
    queue.push(item);
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
      const credited = cur.score;
      scoreByInput.set(uuid, (scoreByInput.get(uuid) ?? 0) + credited);
      if (credited > (bestScoreByInput.get(uuid) ?? 0)) {
        bestScoreByInput.set(uuid, credited);
        bestPathByInput.set(uuid, cur.path);
      }
      continue;
    }

    const inbound = getInboundEdges(uuid) ?? [];
    if (!Array.isArray(inbound) || inbound.length === 0) continue;

    const allocation = computeInboundSynapseImpactAllocation({
      toUuid: uuid,
      neuronImpact: null,
      inboundSynapses: inbound.map((e) => ({
        fromUuid: e.fromUuid,
        toUuid: e.toUuid,
        weight: e.weight,
        meanContribution: e.meanContribution ?? null,
        contributions: Array.isArray(e.contributions) ? e.contributions : null,
      })),
      toNeuronSquash: getNeuronSquash(uuid) ?? null,
      recordedActivationMax: typeof getRecordedActivationMax(uuid) === "number"
        ? getRecordedActivationMax(uuid)
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
      if (cur.path.includes(nextUuid)) continue;
      push({
        uuid: nextUuid,
        score: nextScore,
        depth: cur.depth + 1,
        path: [nextUuid].concat(cur.path),
      });
    }
  }

  const inputs = Array.from(scoreByInput.entries())
    .map(([uuid, score]) => ({
      uuid,
      score,
      path: bestPathByInput.get(uuid) ?? [uuid],
    }))
    .sort((a, b) => b.score - a.score);
  const denom = inputs.reduce((acc, r) => acc + (r.score ?? 0), 0) || 1;
  for (const r of inputs) r.score = r.score / denom;
  return { focusUuid, inputs, truncated };
}

function fmt(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms.toFixed(1)} ms`;
}

const path = Deno.args[0];
if (!path) {
  console.error(
    "usage: deno run -A scripts/benchmark_subgraph_559.ts <snapshot.json>",
  );
  Deno.exit(2);
}

const snapshot = JSON.parse(await Deno.readTextFile(path));
const { neuronsByUuid, synapses } = normaliseCreature(snapshot);

const derivedSynapses = snapshot?.derived?.synapses ?? {};
const inboundByTo = new Map<string, Edge[]>();
for (const s of synapses) {
  const stats = derivedSynapses?.[`${s.fromUuid}→${s.toUuid}`];
  if (!inboundByTo.has(s.toUuid)) inboundByTo.set(s.toUuid, []);
  inboundByTo.get(s.toUuid)!.push({
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
const neurons = neuronsByUuid as Map<string, { uuid: string; squash?: string }>;
const outputUuids = [...neurons.values()]
  .filter((n) => String(n.uuid).startsWith("output-"))
  .map((n) => n.uuid);

const shared = {
  getInboundEdges: (uuid: string) => inboundByTo.get(uuid) ?? [],
  getNeuronSquash: (uuid: string) => neurons.get(uuid)?.squash ?? null,
  getRecordedActivationMax: (uuid: string) =>
    (recordedMax as Record<string, number>)?.[uuid] ?? null,
};

console.log(
  `Network: ${neuronsByUuid.size} neurons / ${synapses.length} synapses / ${outputUuids.length} output(s)`,
);

// before ----------------------------------------------------------------
let t0 = performance.now();
const beforeByOutput = outputUuids.map((o) =>
  oldExhaustiveWalk({ focusUuid: o, ...shared, maxDepth: 24, maxWork: 60000 })
);
const beforeMs = performance.now() - t0;

// after -----------------------------------------------------------------
t0 = performance.now();
const afterByOutput = outputUuids.map((o) =>
  computeTopContributingInputs({
    focusUuid: o,
    exhaustive: true,
    ...shared,
    maxDepth: 24,
    maxWork: 60000,
  })
);
const afterMs = performance.now() - t0;

// full buildSubgraphSource (new) ----------------------------------------
t0 = performance.now();
const source = buildSubgraphSource(snapshot);
const fullMs = performance.now() - t0;

// ranking agreement (top 20 by set/order) -------------------------------
function topUuids(walk: { inputs: { uuid: string }[] }, n: number) {
  return walk.inputs.slice(0, n).map((r) => r.uuid);
}
let agree = true;
for (let i = 0; i < outputUuids.length; i++) {
  const b = topUuids(beforeByOutput[i], 20).join(",");
  const a = topUuids(afterByOutput[i], 20).join(",");
  if (a !== b) agree = false;
}

console.log("");
console.log(`before (old exhaustive walk)      : ${fmt(beforeMs)}`);
console.log(`after  (memoised DAG propagation) : ${fmt(afterMs)}`);
console.log(
  `speed-up                          : ${(beforeMs / afterMs).toFixed(1)}x`,
);
console.log(`full buildSubgraphSource (new)    : ${fmt(fullMs)}`);
console.log(`ranked paths (new)                : ${source.rankedPaths.length}`);
console.log(`top-20 ranking agrees before↔after: ${agree ? "yes" : "NO"}`);
