import { assertEquals } from "./test_helpers.ts";
import {
  formatTraceScore,
  hasOverflowActions,
  nextOverflowState,
  shouldCollapseTraceOverflow,
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

// ---------------------------------------------------------------------------
// shouldCollapseTraceOverflow — Issue #246
// ---------------------------------------------------------------------------

Deno.test("shouldCollapseTraceOverflow inline when children fit", () => {
  assertEquals(
    shouldCollapseTraceOverflow({ barWidth: 800, childrenWidth: 400 }),
    false,
  );
});

Deno.test("shouldCollapseTraceOverflow collapsed when children overflow", () => {
  assertEquals(
    shouldCollapseTraceOverflow({ barWidth: 320, childrenWidth: 600 }),
    true,
  );
});

Deno.test("shouldCollapseTraceOverflow inline when widths are equal", () => {
  // Edge case: childrenWidth === barWidth ⇒ inline (the row exactly fits).
  assertEquals(
    shouldCollapseTraceOverflow({ barWidth: 500, childrenWidth: 500 }),
    false,
  );
});

Deno.test("shouldCollapseTraceOverflow respects padding", () => {
  // 500 - 40 padding = 460 available; children at 480 overflow.
  assertEquals(
    shouldCollapseTraceOverflow({
      barWidth: 500,
      childrenWidth: 480,
      padding: 40,
    }),
    true,
  );
  // With no padding the same children would fit.
  assertEquals(
    shouldCollapseTraceOverflow({ barWidth: 500, childrenWidth: 480 }),
    false,
  );
});

Deno.test("shouldCollapseTraceOverflow returns false for invalid input", () => {
  assertEquals(shouldCollapseTraceOverflow(null as never), false);
  assertEquals(shouldCollapseTraceOverflow(undefined as never), false);
  assertEquals(shouldCollapseTraceOverflow({}), false);
  assertEquals(
    shouldCollapseTraceOverflow({ barWidth: NaN, childrenWidth: 100 }),
    false,
  );
  assertEquals(
    shouldCollapseTraceOverflow({ barWidth: 100, childrenWidth: NaN }),
    false,
  );
  // Zero/negative widths fall back to inline (first paint pass).
  assertEquals(
    shouldCollapseTraceOverflow({ barWidth: 0, childrenWidth: 200 }),
    false,
  );
  assertEquals(
    shouldCollapseTraceOverflow({ barWidth: 500, childrenWidth: 0 }),
    false,
  );
});

// ---------------------------------------------------------------------------
// hasOverflowActions — Issue #384
// ---------------------------------------------------------------------------

Deno.test("hasOverflowActions true when at least one visible action", () => {
  assertEquals(hasOverflowActions({ visibleActionCount: 1 }), true);
  assertEquals(hasOverflowActions({ visibleActionCount: 3 }), true);
});

Deno.test("hasOverflowActions false when zero visible actions", () => {
  // No actions to reveal ⇒ the "⋯" button must not be shown.
  assertEquals(hasOverflowActions({ visibleActionCount: 0 }), false);
});

Deno.test("hasOverflowActions false for invalid input", () => {
  assertEquals(hasOverflowActions(null as never), false);
  assertEquals(hasOverflowActions(undefined as never), false);
  assertEquals(hasOverflowActions({}), false);
  assertEquals(hasOverflowActions({ visibleActionCount: NaN }), false);
  assertEquals(
    hasOverflowActions({ visibleActionCount: -1 }),
    false,
  );
});
