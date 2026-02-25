/**
 * Tests for input correlation analysis (docs/shared/correlation.js).
 *
 * These are "what" tests: import the module, call functions with test data,
 * assert results.
 */

import {
  computeTopInputCorrelations,
  pearsonCorrelation,
  sampleSeries,
} from "../docs/shared/correlation.js";
import { approx, assert, assertEquals } from "./test_helpers.ts";

// ---------------------------------------------------------------------------
// pearsonCorrelation
// ---------------------------------------------------------------------------

Deno.test("pearsonCorrelation returns 1 for perfectly correlated series", () => {
  const x = [1, 2, 3, 4, 5];
  const y = [2, 4, 6, 8, 10];
  approx(pearsonCorrelation(x, y), 1.0, 1e-9);
});

Deno.test("pearsonCorrelation returns -1 for perfectly anti-correlated series", () => {
  const x = [1, 2, 3, 4, 5];
  const y = [10, 8, 6, 4, 2];
  approx(pearsonCorrelation(x, y), -1.0, 1e-9);
});

Deno.test("pearsonCorrelation returns 0 for uncorrelated series", () => {
  // Orthogonal: constant y has zero variance → r = 0
  const x = [1, 2, 3, 4, 5];
  const y = [5, 5, 5, 5, 5];
  approx(pearsonCorrelation(x, y), 0, 1e-9);
});

Deno.test("pearsonCorrelation returns 0 for fewer than 3 data points", () => {
  assertEquals(pearsonCorrelation([1], [2]), 0);
  assertEquals(pearsonCorrelation([1, 2], [3, 4]), 0);
  assertEquals(pearsonCorrelation([], []), 0);
});

Deno.test("pearsonCorrelation handles mismatched lengths by using shorter", () => {
  const x = [1, 2, 3, 4, 5];
  const y = [2, 4, 6]; // only 3 elements
  const r = pearsonCorrelation(x, y);
  approx(r, 1.0, 1e-9);
});

// ---------------------------------------------------------------------------
// sampleSeries
// ---------------------------------------------------------------------------

Deno.test("sampleSeries returns original if shorter than maxLen", () => {
  const arr = [1, 2, 3];
  const result = sampleSeries(arr, 10);
  assertEquals(result.length, 3);
});

Deno.test("sampleSeries downsamples to target length", () => {
  const arr = Array.from({ length: 100 }, (_, i) => i);
  const result = sampleSeries(arr, 10);
  assertEquals(result.length, 10);
});

Deno.test("sampleSeries enforces minimum length of 8", () => {
  const arr = Array.from({ length: 100 }, (_, i) => i);
  const result = sampleSeries(arr, 3);
  assertEquals(result.length, 8);
});

Deno.test("sampleSeries replaces non-finite values with 0", () => {
  const arr = Array.from({ length: 20 }, () => NaN);
  const result = sampleSeries(arr, 8);
  for (const v of result) assertEquals(v, 0);
});

// ---------------------------------------------------------------------------
// computeTopInputCorrelations
// ---------------------------------------------------------------------------

Deno.test("computeTopInputCorrelations returns empty for fewer than 2 inputs", () => {
  const result = computeTopInputCorrelations({
    recording: { neurons: { "input-0": { activation: [1, 2, 3, 4, 5] } } },
    inputCount: 1,
  });
  assertEquals(result.length, 0);
});

Deno.test("computeTopInputCorrelations finds perfectly correlated pair", () => {
  const recording = {
    neurons: {
      "input-0": { activation: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
      "input-1": { activation: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20] },
    },
  };
  const result = computeTopInputCorrelations({
    recording,
    inputCount: 2,
    topK: 5,
  });
  assertEquals(result.length, 1);
  assertEquals(result[0].a, "input-0");
  assertEquals(result[0].b, "input-1");
  approx(result[0].r, 1.0, 1e-6);
});

Deno.test("computeTopInputCorrelations respects topK limit", () => {
  // Create 4 inputs → 6 pairs, request topK=2
  const recording = {
    neurons: {
      "input-0": { activation: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
      "input-1": { activation: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20] },
      "input-2": { activation: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1] },
      "input-3": { activation: [5, 3, 7, 1, 9, 2, 8, 4, 6, 0] },
    },
  };
  const result = computeTopInputCorrelations({
    recording,
    inputCount: 4,
    topK: 2,
  });
  assertEquals(result.length, 2);
  // Results should be sorted by |r| descending
  assert(Math.abs(result[0].r) >= Math.abs(result[1].r));
});

Deno.test("computeTopInputCorrelations returns empty for no recording", () => {
  const result = computeTopInputCorrelations({
    recording: null,
    inputCount: 5,
  });
  assertEquals(result.length, 0);
});

Deno.test("computeTopInputCorrelations skips inputs with short series", () => {
  const recording = {
    neurons: {
      "input-0": { activation: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
      "input-1": { activation: [1, 2] }, // too short (<=4)
    },
  };
  const result = computeTopInputCorrelations({
    recording,
    inputCount: 2,
    topK: 5,
  });
  assertEquals(result.length, 0);
});

Deno.test("computeTopInputCorrelations respects maxInputs cap", () => {
  const neurons: Record<string, { activation: number[] }> = {};
  for (let i = 0; i < 10; i++) {
    neurons[`input-${i}`] = {
      activation: Array.from({ length: 20 }, (_, j) => j + i),
    };
  }
  const result = computeTopInputCorrelations({
    recording: { neurons },
    inputCount: 10,
    maxInputs: 3, // only consider first 3
    topK: 10,
  });
  // All pairs should only be among input-0, input-1, input-2
  for (const pair of result) {
    const aIdx = parseInt(pair.a.replace("input-", ""));
    const bIdx = parseInt(pair.b.replace("input-", ""));
    assert(aIdx < 3, `Expected input index < 3 but got ${aIdx}`);
    assert(bIdx < 3, `Expected input index < 3 but got ${bIdx}`);
  }
});

Deno.test("computeTopInputCorrelations uses value series as fallback", () => {
  const recording = {
    neurons: {
      "input-0": { value: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
      "input-1": { value: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20] },
    },
  };
  const result = computeTopInputCorrelations({
    recording,
    inputCount: 2,
    topK: 5,
  });
  assertEquals(result.length, 1);
  approx(result[0].r, 1.0, 1e-6);
});
