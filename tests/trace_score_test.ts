import { assertEquals } from "./test_helpers.ts";
import { formatTraceScore } from "../docs/shared/trace_score.js";

// ---------------------------------------------------------------------------
// formatTraceScore — Issue #184 breadcrumb score badge.
// ---------------------------------------------------------------------------

Deno.test("formatTraceScore returns em dash for null", () => {
  assertEquals(formatTraceScore(null), "—");
});

Deno.test("formatTraceScore returns em dash for undefined", () => {
  assertEquals(formatTraceScore(undefined), "—");
});

Deno.test("formatTraceScore returns em dash for NaN", () => {
  assertEquals(formatTraceScore(NaN), "—");
});

Deno.test("formatTraceScore returns em dash for Infinity", () => {
  assertEquals(formatTraceScore(Infinity), "—");
});

Deno.test("formatTraceScore returns em dash for non-numeric string", () => {
  assertEquals(formatTraceScore("hello"), "—");
});

Deno.test("formatTraceScore returns '0%' for zero", () => {
  assertEquals(formatTraceScore(0), "0%");
});

Deno.test("formatTraceScore formats a typical high impact as percent", () => {
  // 0.746 → 74.6% (one decimal place when ≥10%)
  assertEquals(formatTraceScore(0.746), "74.6%");
});

Deno.test("formatTraceScore formats a low impact with two decimals", () => {
  // 0.0341 → 3.41% (two decimals when in [1%, 10%))
  assertEquals(formatTraceScore(0.0341), "3.41%");
});

Deno.test("formatTraceScore formats very small impact with precision 2", () => {
  // 0.0001 → 0.010% (precision 2)
  assertEquals(formatTraceScore(0.0001), "0.010%");
});

Deno.test("formatTraceScore handles a numeric string", () => {
  assertEquals(formatTraceScore("0.5"), "50.0%");
});

Deno.test("formatTraceScore handles a full-impact value of 1", () => {
  assertEquals(formatTraceScore(1), "100.0%");
});
