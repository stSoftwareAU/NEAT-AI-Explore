import { approx, assert, assertEquals } from "./test_helpers.ts";

import {
  computeSquashDerivativeStats,
  ELU_ALPHA,
  EXP_CLAMP_MAX,
  GAUSSIAN_CLAMP_MAX,
  GELU_APPROX_COEFF,
  LEAKY_RELU_SLOPE,
  SELU_ALPHA,
  SELU_LAMBDA,
  squashDerivative,
} from "../docs/impact_diagnostics.js";

// --- Constant value tests ---
//
// These pin *published, spec-defined* activation-function parameters, so the
// exact literal is the contract (a change to the number would be a genuine
// regression against the published spec). Arbitrary numerical-stability tuning
// constants (NEAR_ZERO_THRESHOLD, EXP_CLAMP_MAX, GAUSSIAN_CLAMP_MAX) are
// deliberately NOT pinned here — their contract is behavioural and is verified
// by the behaviour tests below, so a behaviour-preserving retune stays green.

Deno.test("SELU_LAMBDA matches the standard SELU scale factor", () => {
  approx(SELU_LAMBDA, 1.0507009873554805, 1e-15);
});

Deno.test("SELU_ALPHA matches the standard SELU alpha parameter", () => {
  approx(SELU_ALPHA, 1.6732632423543772, 1e-15);
});

Deno.test("GELU_APPROX_COEFF is the standard tanh-approximation coefficient", () => {
  assertEquals(GELU_APPROX_COEFF, 0.044715);
});

Deno.test("LEAKY_RELU_SLOPE is the standard negative-slope coefficient", () => {
  assertEquals(LEAKY_RELU_SLOPE, 0.01);
});

Deno.test("ELU_ALPHA defaults to 1", () => {
  assertEquals(ELU_ALPHA, 1);
});

// --- Behavioural tests verifying constants drive function behaviour ---

Deno.test("NEAR_ZERO_THRESHOLD counts tiny derivatives as near-zero", () => {
  // Behavioural contract: derivatives whose magnitude falls below the
  // near-zero guardrail are counted as saturated, larger ones are not. The
  // exact threshold is a tuning number, so this asserts the observable
  // classification rather than the literal — a behaviour-preserving retune of
  // NEAR_ZERO_THRESHOLD keeps this green.
  const neuronsByUuid = new Map([
    ["identity-0", { uuid: "identity-0", type: "output", squash: "IDENTITY" }],
    ["relu-0", { uuid: "relu-0", type: "output", squash: "RELU" }],
  ]);
  // IDENTITY derivative = 1 everywhere (well above the guardrail).
  // RELU derivative at non-positive inputs = 0 (below the guardrail).
  const preActivations = new Map([
    ["identity-0", [0.5, -0.5, 2]],
    ["relu-0", [-1, -2, -3]],
  ]);
  const stats = computeSquashDerivativeStats({ neuronsByUuid, preActivations });
  approx(stats.get("identity-0")?.fracNearZero ?? -1, 0);
  approx(stats.get("relu-0")?.fracNearZero ?? -1, 1);
});

Deno.test("LEAKYRELU uses LEAKY_RELU_SLOPE for negative inputs", () => {
  const r = squashDerivative("LEAKYRELU", -5);
  assert(r.d != null);
  approx(r.d!, LEAKY_RELU_SLOPE, 1e-15);
});

Deno.test("SELU positive region derivative equals SELU_LAMBDA", () => {
  const r = squashDerivative("SELU", 1);
  assert(r.d != null);
  approx(r.d!, SELU_LAMBDA, 1e-15);
});

Deno.test("SELU negative region uses SELU_LAMBDA and SELU_ALPHA", () => {
  const x = -1;
  const r = squashDerivative("SELU", x);
  assert(r.d != null);
  approx(r.d!, SELU_LAMBDA * SELU_ALPHA * Math.exp(x), 1e-12);
});

Deno.test("ELU negative region uses ELU_ALPHA", () => {
  const x = -2;
  const r = squashDerivative("ELU", x);
  assert(r.d != null);
  approx(r.d!, ELU_ALPHA * Math.exp(x), 1e-12);
});

Deno.test("EXP clamps extreme inputs to avoid Infinity", () => {
  // A value far beyond EXP_CLAMP_MAX should be clamped, not Infinity.
  const huge = squashDerivative("EXP", 1000);
  assert(huge.d != null);
  assert(Number.isFinite(huge.d!), "EXP derivative at x=1000 should be finite");
  approx(huge.d!, Math.exp(EXP_CLAMP_MAX), 1e-6);

  // Negative extreme should also be clamped.
  const tiny = squashDerivative("EXP", -1000);
  assert(tiny.d != null);
  assert(
    Number.isFinite(tiny.d!),
    "EXP derivative at x=-1000 should be finite",
  );
  approx(tiny.d!, Math.exp(-EXP_CLAMP_MAX), 1e-30);
});

Deno.test("GAUSSIAN clamps extreme inputs to avoid underflow", () => {
  // At x = GAUSSIAN_CLAMP_MAX, exp(-x^2) underflows to 0.
  // At x > GAUSSIAN_CLAMP_MAX, clamping should still produce a finite result.
  const r = squashDerivative("GAUSSIAN", 200);
  assert(r.d != null);
  assert(
    Number.isFinite(r.d!),
    "GAUSSIAN derivative at x=200 should be finite",
  );

  // Value at the clamp boundary
  const atClamp = squashDerivative("GAUSSIAN", GAUSSIAN_CLAMP_MAX);
  assert(atClamp.d != null);
  assert(Number.isFinite(atClamp.d!));
});

Deno.test("GELU derivative uses GELU_APPROX_COEFF in tanh approximation", () => {
  // Verify at a non-trivial point (x = 1) that the derivative matches the
  // formula using GELU_APPROX_COEFF.
  const x = 1;
  const inner = Math.sqrt(2 / Math.PI) *
    (x + GELU_APPROX_COEFF * Math.pow(x, 3));
  const tanhInner = Math.tanh(inner);
  const cdf = 0.5 * (1 + tanhInner);
  const pdf = (0.5 * x * (1 - tanhInner * tanhInner)) *
    Math.sqrt(2 / Math.PI) *
    (1 + 3 * GELU_APPROX_COEFF * x * x);
  const expected = cdf + pdf;

  const r = squashDerivative("GELU", x);
  assert(r.d != null);
  approx(r.d!, expected, 1e-12);
});
