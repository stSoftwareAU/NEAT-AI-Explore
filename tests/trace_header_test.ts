import { assertEquals } from "./test_helpers.ts";
import {
  formatTraceScore,
  nextOverflowState,
  shouldUseCompactHeader,
} from "../docs/shared/trace_header.js";

// ---------------------------------------------------------------------------
// formatTraceScore — happy path
// ---------------------------------------------------------------------------

Deno.test("formatTraceScore trims trailing zeros for compact display", () => {
  assertEquals(formatTraceScore({ totalScore: 1.23 }), "1.23");
  assertEquals(formatTraceScore({ totalScore: 0.5 }), "0.5");
});

Deno.test("formatTraceScore honours precision argument", () => {
  assertEquals(formatTraceScore({ totalScore: 0.12345678 }, 4), "0.1235");
  assertEquals(formatTraceScore({ totalScore: 0.12345678 }, 6), "0.123457");
});

Deno.test("formatTraceScore handles zero", () => {
  assertEquals(formatTraceScore({ totalScore: 0 }), "0");
});

Deno.test("formatTraceScore handles negative values", () => {
  assertEquals(formatTraceScore({ totalScore: -3.14 }), "-3.14");
});

Deno.test("formatTraceScore preserves exponential form for very small numbers", () => {
  const out = formatTraceScore({ totalScore: 1.23e-9 });
  // Exponential form should be left untouched (no trailing-zero stripping).
  if (out === null || !/e/i.test(out)) {
    throw new Error(`expected exponential form, got ${JSON.stringify(out)}`);
  }
});

// ---------------------------------------------------------------------------
// formatTraceScore — error / edge cases
// ---------------------------------------------------------------------------

Deno.test("formatTraceScore returns null when allocation is null/undefined", () => {
  assertEquals(formatTraceScore(null), null);
  assertEquals(formatTraceScore(undefined), null);
});

Deno.test("formatTraceScore returns null when totalScore is missing", () => {
  assertEquals(formatTraceScore({}), null);
});

Deno.test("formatTraceScore returns null for non-finite or non-numeric scores", () => {
  assertEquals(formatTraceScore({ totalScore: NaN }), null);
  assertEquals(formatTraceScore({ totalScore: Infinity }), null);
  assertEquals(formatTraceScore({ totalScore: -Infinity }), null);
  // String values are intentionally rejected — totalScore must be a number.
  assertEquals(formatTraceScore({ totalScore: "1.0" }), null);
});

Deno.test("formatTraceScore clamps invalid precision values", () => {
  // Negative / zero precision falls back to default (4 sig figs).
  assertEquals(formatTraceScore({ totalScore: 0.12345678 }, 0), "0.1235");
  assertEquals(formatTraceScore({ totalScore: 0.12345678 }, -2), "0.1235");
  // NaN precision falls back to default.
  assertEquals(formatTraceScore({ totalScore: 0.12345678 }, NaN), "0.1235");
});

// ---------------------------------------------------------------------------
// shouldUseCompactHeader
// ---------------------------------------------------------------------------

Deno.test("shouldUseCompactHeader returns true for phone widths", () => {
  assertEquals(shouldUseCompactHeader(320), true); // small phone
  assertEquals(shouldUseCompactHeader(375), true); // iPhone SE
  assertEquals(shouldUseCompactHeader(393), true); // iPhone 15
  assertEquals(shouldUseCompactHeader(639), true);
});

Deno.test("shouldUseCompactHeader returns false at and above MOBILE_MAX", () => {
  assertEquals(shouldUseCompactHeader(640), false);
  assertEquals(shouldUseCompactHeader(768), false); // tablet
  assertEquals(shouldUseCompactHeader(1024), false); // desktop
  assertEquals(shouldUseCompactHeader(1920), false);
});

Deno.test("shouldUseCompactHeader returns false for invalid inputs", () => {
  assertEquals(shouldUseCompactHeader(NaN), false);
  assertEquals(shouldUseCompactHeader(Infinity), false);
  // Non-numeric inputs are coerced to false rather than throwing.
  assertEquals(shouldUseCompactHeader("400" as unknown as number), false);
  assertEquals(shouldUseCompactHeader(undefined as unknown as number), false);
});

// ---------------------------------------------------------------------------
// nextOverflowState
// ---------------------------------------------------------------------------

Deno.test("nextOverflowState flips boolean state", () => {
  assertEquals(nextOverflowState(false), true);
  assertEquals(nextOverflowState(true), false);
});
