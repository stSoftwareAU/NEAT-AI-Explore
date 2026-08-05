/**
 * Exhaustive-mode ranking regression tests (Issue #559).
 *
 * Issue #559 replaced the exhaustive upstream walk in `computeTopContributingInputs`
 * — which enumerated every path and froze for ~71 s on the published snapshot —
 * with a memoised DAG propagation. These tests pin the two contracts that swap
 * had to keep:
 *
 *  1. **Exhaustive ranking is unchanged.** A faithful copy of the *pre-#559*
 *     exhaustive walk (`referenceExhaustiveWalk`, below) is the golden
 *     reference. On hand-built small DAGs the new implementation must return the
 *     same set, ordering, scores and best paths.
 *  2. **The default (non-exhaustive) mode is untouched.** A snapshot case pins
 *     `computeTopContributingInputs` with `exhaustive` omitted so the default
 *     path other views rely on cannot drift.
 *
 * The fixtures use exact binary-fraction shares so the golden reference and the
 * new propagation agree to the bit, not merely within a tolerance.
 */

import { approx, assert, assertEquals } from "./test_helpers.ts";

import {
  allocationStepsForNode,
  computeTopContributingInputs,
} from "../docs/shared/graph_analysis.js";

type Edge = {
  fromUuid: string;
  toUuid: string;
  weight: number;
  meanContribution?: number | null;
  contributions?: number[] | null;
};

type WalkInput = {
  uuid: string;
  score: number;
  path: string[];
  gateMaskedFraction?: number;
};

type WalkResult = {
  focusUuid: string;
  inputs: WalkInput[];
  truncated: boolean;
};

/**
 * Golden reference: a faithful copy of the pre-#559 exhaustive walk (the
 * uncapped best-first path enumeration). This is deliberately *not* the
 * production code — it exists so the memoised propagation can be checked
 * against the exact behaviour it replaced. Only the exhaustive caps are inlined
 * (maxDepth 32, unbounded fan-out, work 100000, queue 5000); on the small
 * fixtures here none of them bite, so it enumerates every path.
 */
function referenceExhaustiveWalk(
  focusUuid: string,
  getInboundEdges: (toUuid: string) => Edge[],
  getNeuronSquash: (uuid: string) => string | null = () => null,
  getRecordedActivationMax: (uuid: string) => number | null = () => null,
): WalkResult {
  const maxDepth = 32;
  const maxWork = 100000;
  const maxInboundPerNode = Number.MAX_SAFE_INTEGER;
  const queueCap = 5000;

  const scoreByInput = new Map<string, number>();
  const bestPathByInput = new Map<string, string[]>();
  const bestScoreByInput = new Map<string, number>();
  const gateMaskedByInput = new Map<string, number>();

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
      const af = 1;
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

    // Shared step rule (#598) — the reference walk differs from production only
    // in its traversal, never in how a node's inbound shares are computed.
    const steps = allocationStepsForNode({
      uuid,
      inbound,
      getNeuronSquash,
      getRecordedActivationMax,
      maxInboundPerNode,
    });

    for (const s of steps) {
      const nextUuid = s.uuid;
      const nextScore = cur.score * (s.share ?? 0);
      if (nextScore <= 0) continue;
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

  const denom = inputs.reduce((acc, r) => acc + (r.score ?? 0), 0) || 1;
  for (const r of inputs) r.score = r.score / denom;

  return { focusUuid, inputs, truncated };
}

/** Assert two walk results are equal: order, scores, paths and gate fractions. */
function assertResultsEqual(
  actual: WalkResult,
  expected: WalkResult,
  label: string,
) {
  assertEquals(actual.focusUuid, expected.focusUuid, `${label}: focusUuid`);
  assertEquals(actual.truncated, expected.truncated, `${label}: truncated`);
  assertEquals(
    actual.inputs.length,
    expected.inputs.length,
    `${label}: input count`,
  );
  for (let i = 0; i < expected.inputs.length; i++) {
    const a = actual.inputs[i];
    const e = expected.inputs[i];
    assertEquals(a.uuid, e.uuid, `${label}: inputs[${i}].uuid`);
    approx(a.score, e.score, 1e-12, `${label}: inputs[${i}].score`);
    approx(
      a.gateMaskedFraction ?? 0,
      e.gateMaskedFraction ?? 0,
      1e-12,
      `${label}: inputs[${i}].gateMaskedFraction`,
    );
    assertEquals(
      JSON.stringify(a.path),
      JSON.stringify(e.path),
      `${label}: inputs[${i}].path`,
    );
  }
}

// A diamond: output-0 ← {hidden-a, hidden-b} ← {input-0, input-1}.
// All shares are exact binary fractions.
const DIAMOND: Record<string, Edge[]> = {
  "output-0": [
    {
      fromUuid: "hidden-a",
      toUuid: "output-0",
      weight: 1,
      meanContribution: 3,
    },
    {
      fromUuid: "hidden-b",
      toUuid: "output-0",
      weight: 1,
      meanContribution: 1,
    },
  ],
  "hidden-a": [
    { fromUuid: "input-0", toUuid: "hidden-a", weight: 1, meanContribution: 2 },
    { fromUuid: "input-1", toUuid: "hidden-a", weight: 1, meanContribution: 2 },
  ],
  "hidden-b": [
    { fromUuid: "input-0", toUuid: "hidden-b", weight: 1, meanContribution: 1 },
    { fromUuid: "input-1", toUuid: "hidden-b", weight: 1, meanContribution: 3 },
  ],
};

// A deeper DAG with a shared intermediate (hidden-z reached from x and y).
const SHARED: Record<string, Edge[]> = {
  "output-0": [
    {
      fromUuid: "hidden-x",
      toUuid: "output-0",
      weight: 1,
      meanContribution: 1,
    },
    {
      fromUuid: "hidden-y",
      toUuid: "output-0",
      weight: 1,
      meanContribution: 1,
    },
  ],
  "hidden-x": [
    {
      fromUuid: "hidden-z",
      toUuid: "hidden-x",
      weight: 1,
      meanContribution: 1,
    },
    { fromUuid: "input-0", toUuid: "hidden-x", weight: 1, meanContribution: 1 },
  ],
  "hidden-y": [
    {
      fromUuid: "hidden-z",
      toUuid: "hidden-y",
      weight: 1,
      meanContribution: 3,
    },
    { fromUuid: "input-1", toUuid: "hidden-y", weight: 1, meanContribution: 1 },
  ],
  "hidden-z": [
    { fromUuid: "input-2", toUuid: "hidden-z", weight: 1, meanContribution: 1 },
  ],
};

const edgesOf = (g: Record<string, Edge[]>) => (uuid: string) => g[uuid] ?? [];

Deno.test("exhaustive mode: memoised propagation matches the pre-#559 walk (diamond)", () => {
  const actual = computeTopContributingInputs({
    focusUuid: "output-0",
    getInboundEdges: edgesOf(DIAMOND),
    exhaustive: true,
  }) as WalkResult;
  const expected = referenceExhaustiveWalk("output-0", edgesOf(DIAMOND));
  assertResultsEqual(actual, expected, "diamond");
});

Deno.test("exhaustive mode: hand-computed scores and best paths (diamond)", () => {
  const res = computeTopContributingInputs({
    focusUuid: "output-0",
    getInboundEdges: edgesOf(DIAMOND),
    exhaustive: true,
  }) as WalkResult;

  assert(!res.truncated, "memoised propagation is complete, never truncated");
  assertEquals(res.inputs.map((r) => r.uuid).join(","), "input-1,input-0");
  // input-1 = 0.75·0.5 + 0.25·0.75 = 0.5625; input-0 = 0.75·0.5 + 0.25·0.25 = 0.4375.
  approx(res.inputs[0].score, 0.5625, 1e-12, "input-1 share");
  approx(res.inputs[1].score, 0.4375, 1e-12, "input-0 share");
  // Best path for each runs through hidden-a (the stronger branch), input → focus.
  assertEquals(
    JSON.stringify(res.inputs[0].path),
    JSON.stringify(["input-1", "hidden-a", "output-0"]),
  );
  assertEquals(
    JSON.stringify(res.inputs[1].path),
    JSON.stringify(["input-0", "hidden-a", "output-0"]),
  );
});

Deno.test("exhaustive mode: matches the pre-#559 walk on a shared intermediate", () => {
  const actual = computeTopContributingInputs({
    focusUuid: "output-0",
    getInboundEdges: edgesOf(SHARED),
    exhaustive: true,
  }) as WalkResult;
  const expected = referenceExhaustiveWalk("output-0", edgesOf(SHARED));
  assertResultsEqual(actual, expected, "shared");

  // Pin the numbers so a reference-copy bug cannot hide a regression: input-2
  // is reached through hidden-z from both branches (0.25 + 0.375 = 0.625).
  assertEquals(
    actual.inputs.map((r) => r.uuid).join(","),
    "input-2,input-0,input-1",
  );
  approx(actual.inputs[0].score, 0.625, 1e-12, "input-2 share");
  approx(actual.inputs[1].score, 0.25, 1e-12, "input-0 share");
  approx(actual.inputs[2].score, 0.125, 1e-12, "input-1 share");
  assertEquals(
    JSON.stringify(actual.inputs[0].path),
    JSON.stringify(["input-2", "hidden-z", "hidden-y", "output-0"]),
  );
});

Deno.test("exhaustive mode: recurrent back-edge terminates and normalises", () => {
  // hidden-a and hidden-b feed each other (a cycle). The propagation must skip
  // the back-edge, terminate, and still return normalised shares that sum to 1.
  const RECUR: Record<string, Edge[]> = {
    "output-0": [
      {
        fromUuid: "hidden-a",
        toUuid: "output-0",
        weight: 1,
        meanContribution: 1,
      },
    ],
    "hidden-a": [
      {
        fromUuid: "hidden-b",
        toUuid: "hidden-a",
        weight: 1,
        meanContribution: 1,
      },
      {
        fromUuid: "input-0",
        toUuid: "hidden-a",
        weight: 1,
        meanContribution: 1,
      },
    ],
    "hidden-b": [
      {
        fromUuid: "hidden-a",
        toUuid: "hidden-b",
        weight: 1,
        meanContribution: 1,
      },
      {
        fromUuid: "input-1",
        toUuid: "hidden-b",
        weight: 1,
        meanContribution: 1,
      },
    ],
  };
  const res = computeTopContributingInputs({
    focusUuid: "output-0",
    getInboundEdges: edgesOf(RECUR),
    exhaustive: true,
  }) as WalkResult;

  assert(!res.truncated, "propagation completes on a recurrent graph");
  const total = res.inputs.reduce((acc, r) => acc + r.score, 0);
  approx(total, 1, 1e-12, "normalised shares sum to 1");
  for (const r of res.inputs) {
    assert(Number.isFinite(r.score), `finite score for ${r.uuid}`);
    assertEquals(r.path[r.path.length - 1], "output-0", "path ends at focus");
  }
});

Deno.test("non-exhaustive mode is unchanged (byte-for-byte snapshot)", () => {
  // The default path (exhaustive omitted) other views rely on must not drift.
  // On this fixture no cap bites, so the snapshot is exact.
  const res = computeTopContributingInputs({
    focusUuid: "output-0",
    getInboundEdges: edgesOf(DIAMOND),
    maxDepth: 6,
    maxWork: 200,
    maxInboundPerNode: 10,
  }) as WalkResult;

  const snapshot = {
    focusUuid: "output-0",
    truncated: false,
    inputs: [
      {
        uuid: "input-1",
        score: 0.5625,
        path: ["input-1", "hidden-a", "output-0"],
        gateMaskedFraction: 0,
      },
      {
        uuid: "input-0",
        score: 0.4375,
        path: ["input-0", "hidden-a", "output-0"],
        gateMaskedFraction: 0,
      },
    ],
  };
  assertResultsEqual(res, snapshot as WalkResult, "non-exhaustive");
});
