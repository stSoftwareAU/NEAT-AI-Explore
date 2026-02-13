import { approx, assert, assertEquals } from "./test_helpers.ts";

import {
  ELU_ALPHA,
  EXP_CLAMP_MAX,
  GAUSSIAN_CLAMP_MAX,
  GELU_APPROX_COEFF,
  LEAKY_RELU_SLOPE,
  NEAR_ZERO_THRESHOLD,
  SELU_ALPHA,
  SELU_LAMBDA,
  squashDerivative,
} from "../docs/impact_diagnostics.js";

// --- Constant value tests ---

Deno.test("NEAR_ZERO_THRESHOLD is 1e-6", () => {
  assertEquals(NEAR_ZERO_THRESHOLD, 1e-6);
});

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

Deno.test("EXP_CLAMP_MAX is 50", () => {
  assertEquals(EXP_CLAMP_MAX, 50);
});

Deno.test("GAUSSIAN_CLAMP_MAX is 100", () => {
  assertEquals(GAUSSIAN_CLAMP_MAX, 100);
});

// --- Behavioural tests verifying constants drive function behaviour ---

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
