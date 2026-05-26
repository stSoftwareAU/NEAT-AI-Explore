/**
 * Tests for `docs/shared/input_distribution.js` — auto-derived regime
 * thresholds from each input neuron's recorded activation distribution.
 *
 * Issue #271 — distribution primitives consumed by the influence calc's
 * min-gate awareness so thresholds (e.g. "very low volume") flow from the
 * snapshot data rather than hard-coded magic numbers.
 */

import { approx, assert, assertEquals } from "./test_helpers.ts";

import {
  buildInputDistributionMap,
  deriveLowRegimeThreshold,
  summariseInputDistribution,
} from "../docs/shared/input_distribution.js";

// --- summariseInputDistribution: quantile correctness --------------------

Deno.test("summariseInputDistribution computes standard quantiles on 1..100", () => {
  const values = Array.from({ length: 100 }, (_, i) => i + 1);
  const s = summariseInputDistribution(values);
  assertEquals(s.count, 100);
  assertEquals(s.min, 1);
  assertEquals(s.max, 100);
  // Linear interpolation (type-7) on a sorted 1..100 series:
  //   p = q * (N-1) → idx + frac.
  approx(s.p05, 5.95);
  approx(s.p25, 25.75);
  approx(s.p50, 50.5);
  approx(s.p75, 75.25);
  approx(s.p95, 95.05);
});

Deno.test("summariseInputDistribution handles a single-value series", () => {
  const s = summariseInputDistribution([42]);
  assertEquals(s.count, 1);
  assertEquals(s.min, 42);
  assertEquals(s.max, 42);
  assertEquals(s.p05, 42);
  assertEquals(s.p50, 42);
  assertEquals(s.p95, 42);
});

Deno.test("summariseInputDistribution ignores NaN/Infinity values", () => {
  const values = [1, NaN, 2, Infinity, 3, -Infinity, 4, 5];
  const s = summariseInputDistribution(values);
  assertEquals(s.count, 5);
  assertEquals(s.min, 1);
  assertEquals(s.max, 5);
});

// --- summariseInputDistribution: sampling cap ----------------------------

Deno.test("summariseInputDistribution: sub-2048 series uses the full series", () => {
  // 2000 elements, all finite — quantile of the last element should match
  // the full-series value (within tolerance).
  const N = 2000;
  const values = Array.from({ length: N }, (_, i) => i);
  const s = summariseInputDistribution(values);
  assertEquals(s.count, N);
  assertEquals(s.min, 0);
  assertEquals(s.max, N - 1);
  // p50 of 0..1999 = 0.5 * 1999 = 999.5
  approx(s.p50, 999.5);
});

Deno.test("summariseInputDistribution: > 2048 series samples evenly (count capped)", () => {
  const N = 10_000;
  const values = Array.from({ length: N }, (_, i) => i);
  const s = summariseInputDistribution(values);
  // Sampled count is capped at 2048.
  assertEquals(s.count, 2048);
  // Min/max preserved by even sampling (first and last index are taken).
  assertEquals(s.min, 0);
  // The last sampled element is at index floor((2048-1) * (10000/2048))
  // = floor(2047 * 4.8828125) ≈ 9995. Allow some slack — the key invariant
  // is that quantiles are close to the underlying distribution.
  assert(s.max >= 9990 && s.max <= 9999, `unexpected max=${s.max}`);
  // p50 of a uniform 0..9999 sample should be near 4999.5 — within ±50.
  assert(
    Math.abs(s.p50 - 4999.5) < 50,
    `p50 should be near 4999.5, got ${s.p50}`,
  );
});

// --- summariseInputDistribution: empty / all-non-finite ------------------

Deno.test("summariseInputDistribution: empty input returns count=0 with no NaNs", () => {
  const s = summariseInputDistribution([]);
  assertEquals(s.count, 0);
  // No NaNs — the schema is well-defined and safe to consume downstream.
  for (const v of [s.min, s.max, s.p05, s.p25, s.p50, s.p75, s.p95]) {
    assert(Number.isFinite(v), `expected finite, got ${v}`);
  }
});

Deno.test("summariseInputDistribution: all-non-finite returns count=0 with no NaNs", () => {
  const s = summariseInputDistribution([NaN, Infinity, -Infinity, NaN]);
  assertEquals(s.count, 0);
  for (const v of [s.min, s.max, s.p05, s.p25, s.p50, s.p75, s.p95]) {
    assert(Number.isFinite(v), `expected finite, got ${v}`);
  }
});

Deno.test("summariseInputDistribution: non-array input returns count=0", () => {
  // deno-lint-ignore no-explicit-any
  const s = summariseInputDistribution(null as any);
  assertEquals(s.count, 0);
});

// --- deriveLowRegimeThreshold -------------------------------------------

Deno.test("deriveLowRegimeThreshold returns p05 by default", () => {
  const values = Array.from({ length: 100 }, (_, i) => i + 1);
  const s = summariseInputDistribution(values);
  approx(deriveLowRegimeThreshold(s), s.p05);
});

Deno.test("deriveLowRegimeThreshold honours regimeQuantile override (p25)", () => {
  const values = Array.from({ length: 100 }, (_, i) => i + 1);
  const s = summariseInputDistribution(values);
  approx(deriveLowRegimeThreshold(s, { regimeQuantile: "p25" }), s.p25);
});

Deno.test("deriveLowRegimeThreshold honours regimeQuantile override (p50)", () => {
  const values = Array.from({ length: 100 }, (_, i) => i + 1);
  const s = summariseInputDistribution(values);
  approx(deriveLowRegimeThreshold(s, { regimeQuantile: "p50" }), s.p50);
});

Deno.test("deriveLowRegimeThreshold falls back to p05 on unknown quantile", () => {
  const values = Array.from({ length: 100 }, (_, i) => i + 1);
  const s = summariseInputDistribution(values);
  approx(
    deriveLowRegimeThreshold(s, { regimeQuantile: "pbogus" }),
    s.p05,
  );
});

// --- buildInputDistributionMap (snapshot helper) -------------------------

function makeSnapshot() {
  return {
    creature: {
      neurons: [
        { uuid: "input-0", type: "input", squash: "IDENTITY", bias: 0 },
        { uuid: "input-1", type: "input", squash: "IDENTITY", bias: 0 },
        { uuid: "hidden-0", type: "hidden", squash: "TANH", bias: 0 },
      ],
      synapses: [],
      input: 2,
      output: 0,
    },
    recording: {
      neurons: {
        "input-0": { activation: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
        "input-1": { activation: [10, 20, 30, 40, 50] },
        // hidden-0 has no input activation — should be skipped.
        "hidden-0": { activation: [0.1, 0.2, 0.3] },
      },
    },
  };
}

Deno.test("buildInputDistributionMap returns a per-input summary", () => {
  const snap = makeSnapshot();
  const neuronsByUuid = new Map(
    snap.creature.neurons.map((n) => [n.uuid, n]),
  );
  const map = buildInputDistributionMap(snap, neuronsByUuid);
  // Two input neurons.
  assertEquals(map.size, 2);
  assert(map.has("input-0"));
  assert(map.has("input-1"));
  assert(!map.has("hidden-0"));

  const s0 = map.get("input-0")!;
  assertEquals(s0.count, 10);
  assertEquals(s0.min, 1);
  assertEquals(s0.max, 10);

  const s1 = map.get("input-1")!;
  assertEquals(s1.count, 5);
  assertEquals(s1.min, 10);
  assertEquals(s1.max, 50);
});

Deno.test("buildInputDistributionMap caches results on the snapshot object", () => {
  const snap = makeSnapshot();
  const neuronsByUuid = new Map(
    snap.creature.neurons.map((n) => [n.uuid, n]),
  );
  const first = buildInputDistributionMap(snap, neuronsByUuid);
  const second = buildInputDistributionMap(snap, neuronsByUuid);
  // Same reference on subsequent calls — proves the WeakMap cache.
  assertEquals(first === second, true);
});

Deno.test("buildInputDistributionMap: input without recording yields count=0 summary", () => {
  const snap = {
    creature: {
      neurons: [
        { uuid: "input-0", type: "input", squash: "IDENTITY", bias: 0 },
      ],
      synapses: [],
      input: 1,
      output: 0,
    },
    recording: { neurons: {} },
  };
  const neuronsByUuid = new Map(
    snap.creature.neurons.map((n) => [n.uuid, n]),
  );
  const map = buildInputDistributionMap(snap, neuronsByUuid);
  assertEquals(map.size, 1);
  const s = map.get("input-0")!;
  assertEquals(s.count, 0);
});
