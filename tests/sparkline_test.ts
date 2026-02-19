/**
 * Tests for docs/shared/sparkline.js (#107).
 *
 * Exercises the pure computation functions: sparkline point normalisation,
 * error histogram bucketing, squash badge classification, and error flattening.
 */

import { approx, assert, assertEquals } from "./test_helpers.ts";
import {
  computeErrorHistogram,
  computeSparklinePoints,
  flattenErrors,
  squashBadge,
} from "../docs/shared/sparkline.js";

/* ── computeSparklinePoints ─────────────────────────────────────────────── */

Deno.test("computeSparklinePoints returns empty for empty input", () => {
  const r = computeSparklinePoints([]);
  assertEquals(r.points.length, 0);
  assertEquals(r.min, 0);
  assertEquals(r.max, 0);
});

Deno.test("computeSparklinePoints returns empty for null/undefined", () => {
  // deno-lint-ignore no-explicit-any
  const r = computeSparklinePoints(null as any);
  assertEquals(r.points.length, 0);
});

Deno.test("computeSparklinePoints normalises values to 0-1 range", () => {
  const r = computeSparklinePoints([0, 5, 10]);
  assertEquals(r.points.length, 3);
  assertEquals(r.min, 0);
  assertEquals(r.max, 10);

  // x coordinates: 0, 0.5, 1
  approx(r.points[0].x, 0);
  approx(r.points[1].x, 0.5);
  approx(r.points[2].x, 1);

  // y coordinates: 0, 0.5, 1
  approx(r.points[0].y, 0);
  approx(r.points[1].y, 0.5);
  approx(r.points[2].y, 1);
});

Deno.test("computeSparklinePoints handles constant values (flat line)", () => {
  const r = computeSparklinePoints([3, 3, 3]);
  assertEquals(r.points.length, 3);
  // All y values should be 0.5 when range is 0
  for (const p of r.points) {
    approx(p.y, 0.5);
  }
});

Deno.test("computeSparklinePoints handles single value", () => {
  const r = computeSparklinePoints([42]);
  assertEquals(r.points.length, 1);
  approx(r.points[0].x, 0.5);
  approx(r.points[0].y, 0.5);
});

Deno.test("computeSparklinePoints skips NaN and Infinity", () => {
  const r = computeSparklinePoints([1, NaN, 3, Infinity, 5]);
  assertEquals(r.points.length, 3);
  assertEquals(r.min, 1);
  assertEquals(r.max, 5);
});

Deno.test("computeSparklinePoints returns empty when all non-finite", () => {
  const r = computeSparklinePoints([NaN, Infinity, -Infinity]);
  assertEquals(r.points.length, 0);
});

Deno.test("computeSparklinePoints handles negative values", () => {
  const r = computeSparklinePoints([-10, 0, 10]);
  assertEquals(r.min, -10);
  assertEquals(r.max, 10);
  approx(r.points[0].y, 0);
  approx(r.points[1].y, 0.5);
  approx(r.points[2].y, 1);
});

/* ── computeErrorHistogram ──────────────────────────────────────────────── */

Deno.test("computeErrorHistogram returns empty for empty input", () => {
  const r = computeErrorHistogram([]);
  assertEquals(r.buckets.length, 0);
});

Deno.test("computeErrorHistogram buckets values correctly", () => {
  // 10 values from 0 to 9 with 5 buckets
  const values = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const r = computeErrorHistogram(values, 5);
  assertEquals(r.buckets.length, 5);
  assertEquals(r.min, 0);
  assertEquals(r.max, 9);

  // Each bucket should have 2 values
  for (const b of r.buckets) {
    assert(b.count > 0, `Bucket ${b.low}-${b.high} should have values`);
  }
});

Deno.test("computeErrorHistogram ratio is relative to max count", () => {
  const values = [1, 1, 1, 5, 5, 9];
  const r = computeErrorHistogram(values, 3);
  // The bucket with the most items should have ratio = 1
  const maxRatio = Math.max(...r.buckets.map((b) => b.ratio));
  approx(maxRatio, 1.0);
});

Deno.test("computeErrorHistogram handles single value", () => {
  const r = computeErrorHistogram([5], 3);
  assertEquals(r.buckets.length, 3);
  assertEquals(r.min, 5);
  assertEquals(r.max, 5);
  // All values fall into first bucket when range is 0
  assertEquals(r.buckets[0].count, 1);
});

Deno.test("computeErrorHistogram skips non-finite values", () => {
  const r = computeErrorHistogram([1, NaN, 2, Infinity, 3], 3);
  assertEquals(r.min, 1);
  assertEquals(r.max, 3);
  const total = r.buckets.reduce((s, b) => s + b.count, 0);
  assertEquals(total, 3);
});

/* ── squashBadge ────────────────────────────────────────────────────────── */

Deno.test("squashBadge returns blue for SIGMOID", () => {
  const b = squashBadge("SIGMOID");
  assertEquals(b.label, "SIGMOID");
  assertEquals(b.colour, "blue");
});

Deno.test("squashBadge returns orange for STEP", () => {
  const b = squashBadge("STEP");
  assertEquals(b.label, "STEP");
  assertEquals(b.colour, "orange");
});

Deno.test("squashBadge returns green for RELU", () => {
  const b = squashBadge("RELU");
  assertEquals(b.colour, "green");
});

Deno.test("squashBadge returns purple for TANH", () => {
  const b = squashBadge("TANH");
  assertEquals(b.colour, "purple");
});

Deno.test("squashBadge returns grey for IDENTITY", () => {
  const b = squashBadge("IDENTITY");
  assertEquals(b.colour, "grey");
});

Deno.test("squashBadge is case-insensitive", () => {
  const b = squashBadge("sigmoid");
  assertEquals(b.label, "SIGMOID");
  assertEquals(b.colour, "blue");
});

Deno.test("squashBadge handles null/undefined", () => {
  // deno-lint-ignore no-explicit-any
  const b = squashBadge(null as any);
  assertEquals(b.colour, "grey");
});

/* ── flattenErrors ──────────────────────────────────────────────────────── */

Deno.test("flattenErrors flattens 2D error array to absolute values", () => {
  const errors = [[1, -2], [3, -4]];
  const flat = flattenErrors(errors);
  assertEquals(flat.length, 4);
  assertEquals(flat[0], 1);
  assertEquals(flat[1], 2);
  assertEquals(flat[2], 3);
  assertEquals(flat[3], 4);
});

Deno.test("flattenErrors handles 1D error array", () => {
  const flat = flattenErrors([-1, 2, -3]);
  assertEquals(flat.length, 3);
  assertEquals(flat[0], 1);
  assertEquals(flat[1], 2);
  assertEquals(flat[2], 3);
});

Deno.test("flattenErrors returns empty for null", () => {
  const flat = flattenErrors(null);
  assertEquals(flat.length, 0);
});

Deno.test("flattenErrors skips non-finite in 2D arrays", () => {
  const errors = [[1, NaN], [Infinity, 3]];
  const flat = flattenErrors(errors);
  assertEquals(flat.length, 2);
  assertEquals(flat[0], 1);
  assertEquals(flat[1], 3);
});
