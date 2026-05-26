/**
 * Unit tests for `squashEmitCeiling` (docs/shared/squash_bounds.js).
 *
 * Covers the squash families required by issue #270: bounded symmetric/
 * asymmetric families return their analytic ceiling, unbounded families fall
 * back to a recorded activation envelope when available, and unknown/missing
 * squashes fall back gracefully to Infinity without logging.
 */

import { approx, assert, assertEquals } from "./test_helpers.ts";

import { squashEmitCeiling } from "../docs/shared/squash_bounds.js";

Deno.test("squashEmitCeiling: bounded ±1 squash families return 1", () => {
  approx(squashEmitCeiling("TANH"), 1);
  approx(squashEmitCeiling("tanh"), 1, 0, "case-insensitive");
  approx(squashEmitCeiling("HARD_TANH"), 1);
  approx(squashEmitCeiling("BIPOLAR"), 1);
  approx(squashEmitCeiling("BIPOLAR_SIGMOID"), 1);
});

Deno.test("squashEmitCeiling: bounded 0..1 squash families return 1", () => {
  approx(squashEmitCeiling("SIGMOID"), 1);
  approx(squashEmitCeiling("LOGISTIC"), 1);
  approx(squashEmitCeiling("LOGSIG"), 1);
  approx(squashEmitCeiling("STEP"), 1);
});

Deno.test("squashEmitCeiling: unbounded families fall back to recordedActivationMax", () => {
  approx(squashEmitCeiling("RELU", 5.5), 5.5);
  approx(squashEmitCeiling("LEAKY_RELU", 3), 3);
  approx(squashEmitCeiling("IDENTITY", 12.0), 12.0);
});

Deno.test("squashEmitCeiling: unbounded families with no recorded max return Infinity", () => {
  assertEquals(squashEmitCeiling("RELU"), Number.POSITIVE_INFINITY);
  assertEquals(squashEmitCeiling("IDENTITY"), Number.POSITIVE_INFINITY);
  assertEquals(squashEmitCeiling("LEAKY_RELU", null), Number.POSITIVE_INFINITY);
});

Deno.test("squashEmitCeiling: unknown/missing squash returns Infinity gracefully", () => {
  // Capture any console activity to ensure the helper logs nothing.
  const origWarn = console.warn;
  const origError = console.error;
  const origLog = console.log;
  let calls = 0;
  console.warn = (..._args: unknown[]) => calls++;
  console.error = (..._args: unknown[]) => calls++;
  console.log = (..._args: unknown[]) => calls++;

  try {
    assertEquals(squashEmitCeiling(undefined), Number.POSITIVE_INFINITY);
    assertEquals(squashEmitCeiling(null), Number.POSITIVE_INFINITY);
    assertEquals(squashEmitCeiling(""), Number.POSITIVE_INFINITY);
    assertEquals(
      squashEmitCeiling("NOT_A_REAL_SQUASH"),
      Number.POSITIVE_INFINITY,
    );
  } finally {
    console.warn = origWarn;
    console.error = origError;
    console.log = origLog;
  }

  assertEquals(calls, 0, "squashEmitCeiling must not log on unknown squash");
});

Deno.test("squashEmitCeiling: bounded squashes ignore recordedActivationMax (analytic cap wins)", () => {
  // Even if the snapshot recorded a tighter envelope, the analytic ceiling is
  // the right answer for symmetry — recordedActivationMax only helps the
  // unbounded families.
  approx(squashEmitCeiling("TANH", 0.5), 1);
  approx(squashEmitCeiling("SIGMOID", 0.25), 1);
});

Deno.test("squashEmitCeiling: non-positive recordedActivationMax is ignored", () => {
  assertEquals(squashEmitCeiling("RELU", 0), Number.POSITIVE_INFINITY);
  assertEquals(squashEmitCeiling("RELU", -1), Number.POSITIVE_INFINITY);
  assertEquals(
    squashEmitCeiling("RELU", Number.NaN),
    Number.POSITIVE_INFINITY,
  );
  // Confirm assert is exercised so unused-import lint stays clean.
  assert(true);
});
