import { approx, assert } from "./test_helpers.ts";

import {
  computeGradientProxyImpact,
  computeOutgoingProxyTerms,
  computePreActivations,
  computeSquashDerivativeStats,
  squashDerivative,
} from "../docs/impact_diagnostics.js";

Deno.test("squashDerivative TANH is 1 - tanh^2", () => {
  const x = 0.7;
  const t = Math.tanh(x);
  const r = squashDerivative("TANH", x);
  assert(r.d != null);
  approx(r.d, 1 - t * t);
});

Deno.test("squashDerivative SWISH matches NEAT-AI derivative", () => {
  const x = 0.7;
  const sig = 1 / (1 + Math.exp(-x));
  const expected = sig + x * sig * (1 - sig);

  const r = squashDerivative("Swish", x);
  assert(r.note !== "unknown squash", "SWISH should be recognised");
  assert(r.nonSmooth === false, "SWISH should be treated as smooth");
  assert(typeof r.d === "number" && Number.isFinite(r.d));
  approx(r.d, expected, 1e-12);
});

Deno.test("viewer recognises all NEAT-AI activation names (24-Dec-2025)", () => {
  // Keep this list in sync with ../NEAT-AI/src/methods/activations/Activations.ts
  // (but do not import it here, so this repo stays standalone on CI).
  const names = [
    // activations/types/*
    "ABSOLUTE",
    "ArcTan",
    "BENT_IDENTITY",
    "BIPOLAR",
    "BIPOLAR_SIGMOID",
    "COMPLEMENT",
    "Cosine",
    "Cube",
    "ELU",
    "Exponential",
    "GAUSSIAN",
    "GELU",
    "HARD_TANH",
    "IDENTITY",
    "ISRU",
    "LeakyReLU",
    "LOGISTIC",
    "LogSigmoid",
    "Mish",
    "ReLU",
    "ReLU6",
    "SELU",
    "SINE",
    "SOFTSIGN",
    "Softplus",
    "SQRT",
    "SQUARE",
    "StdInverse",
    "STEP",
    "Swish",
    "TAN",
    "TANH",

    // activations/aggregate/*
    "IF",
    "MAXIMUM",
    "MINIMUM",

    // deprecated (still registered in Activations)
    "HYPOT",
    "HYPOTv2",
    "MEAN",

    // Common NEAT-AI aliases
    "CLIPPED",
    "INVERSE",
    "SINUSOID",
    "RELU",
  ];

  for (const name of names) {
    const r = squashDerivative(name, 0.123);
    assert(
      r.note !== "unknown squash",
      `Expected ${name} to be recognised (note=${r.note})`,
    );
  }
});

Deno.test("gradient proxy matches a simple 1-edge network", () => {
  // hidden -> output (w=2), output squash identity
  const neuronsByUuid = new Map([
    ["hidden-0", {
      uuid: "hidden-0",
      type: "hidden",
      squash: "IDENTITY",
      bias: 0,
    }],
    ["output-0", {
      uuid: "output-0",
      type: "output",
      squash: "IDENTITY",
      bias: 0,
    }],
  ]);

  const synapses = [{ fromUuid: "hidden-0", toUuid: "output-0", weight: 2 }];
  const derivedSynapses = {
    "hidden-0→output-0": { contribution: [0, 0, 0] },
  };
  const recordingNeurons = { "output-0": { activation: [0, 0, 0] } };

  const pre = computePreActivations({
    neuronsByUuid,
    synapses,
    derivedSynapses,
    recordingNeurons,
  });
  const stats = computeSquashDerivativeStats({
    neuronsByUuid,
    preActivations: pre,
  });
  assert(stats.get("output-0"));
  approx(stats.get("output-0")?.meanAbsD ?? 0, 1);

  const proxy = computeGradientProxyImpact({
    neuronsByUuid,
    synapses,
    preActivations: pre,
    outputUuids: ["output-0"],
    iterations: 1,
  });

  // sens(output)=1 ; sens(hidden) += 1*|w|*mean|d_out| = 2
  approx(proxy.get("output-0") ?? 0, 1);
  approx(proxy.get("hidden-0") ?? 0, 2);

  const terms = computeOutgoingProxyTerms({
    fromUuid: "hidden-0",
    synapses,
    neuronsByUuid,
    proxySens: proxy,
    squashStats: stats,
  });
  assert(terms.length === 1);
  approx(terms[0].term ?? 0, 2);
});

Deno.test("summariseSeriesStats computes basic stats", async () => {
  // Use a dynamic import here because some editor linters can lag behind JS
  // named export discovery, even though Deno's runtime/type-checker is fine.
  const mod = await import(
    "../docs/impact_diagnostics.js"
  ) as unknown as Record<
    string,
    unknown
  >;
  const summariseSeriesStats = mod.summariseSeriesStats as
    | ((arr: number[], options?: { sampleSize?: number }) => {
      n: number;
      mean: number;
      std: number;
      min: number;
      max: number;
      meanAbs: number;
      maxAbs: number;
      p01: number;
      p50: number;
      p99: number;
    })
    | undefined;

  assert(
    typeof summariseSeriesStats === "function",
    "Expected summariseSeriesStats to be a function export",
  );

  const s = summariseSeriesStats([-2, -1, 0, 1, 2], { sampleSize: 32 });
  assert(s.n === 5);
  approx(s.mean, 0, 1e-12);
  approx(s.min, -2, 1e-12);
  approx(s.max, 2, 1e-12);
  approx(s.meanAbs, 1.2, 1e-12);
  approx(s.maxAbs, 2, 1e-12);

  // Percentiles are exact here because we sample the full array.
  approx(s.p50, 0, 1e-12);
  assert(s.p99 > 1.5, "Expected p99 to be near the upper end");
  assert(s.p01 < -1.5, "Expected p01 to be near the lower end");
});

Deno.test("summariseDeadZoneStats detects clamp and dead ReLU rates", async () => {
  // Use dynamic import here because some editor linters can lag behind JS
  // named export discovery, even though Deno's runtime/type-checker is fine.
  // (Keeps `deno lint` happy in this repo.)
  const mod =
    (await import("../docs/impact_diagnostics.js")) as unknown as Record<
      string,
      unknown
    >;
  const summariseDeadZoneStats = mod.summariseDeadZoneStats as
    | ((squash: string, preActs: number[]) => {
      n: number;
      fracClamped: number | null;
      fracAtZero: number | null;
      nonFiniteCount: number;
      firstNonFiniteIndex: number | null;
    })
    | undefined;

  assert(
    typeof summariseDeadZoneStats === "function",
    "Expected summariseDeadZoneStats to be a function export",
  );

  // HARD_TANH clamps outside [-1, 1].
  const hard = summariseDeadZoneStats("HARD_TANH", [
    -2,
    -1,
    -0.5,
    0,
    0.2,
    1,
    2,
  ]);
  assert(hard.n === 7);
  // clamped: -2, -1, 1, 2 => 4/7
  approx(hard.fracClamped ?? 0, 4 / 7, 1e-12);

  // RELU is "dead" when pre-activation <= 0 (activation becomes 0).
  const relu = summariseDeadZoneStats("ReLU", [-2, -1, 0, 0.1, 2]);
  assert(relu.n === 5);
  approx(relu.fracAtZero ?? 0, 3 / 5, 1e-12);
});

Deno.test("summariseErrorConcentration flags heavy-tail distributions", async () => {
  // Use dynamic import here for the same reason as summariseSeriesStats above.
  const mod =
    (await import("../docs/impact_diagnostics.js")) as unknown as Record<
      string,
      unknown
    >;
  const summariseErrorConcentration = mod.summariseErrorConcentration as
    | ((contrib: number[], options?: { topK?: number }) => {
      n: number;
      total: number;
      topK: { index: number; value: number; shareOfTotal: number }[];
      topKShare: number;
    })
    | undefined;

  assert(
    typeof summariseErrorConcentration === "function",
    "Expected summariseErrorConcentration to be a function export",
  );

  // One obs dominates total squared error.
  const s = summariseErrorConcentration([100, 1, 1, 1, 1], { topK: 2 });
  assert(s.total > 0);
  assert(s.topK.length === 2);
  // Top-1 share should be very high.
  assert(
    (s.topK[0]?.shareOfTotal ?? 0) > 0.9,
    "Expected the top observation to dominate total error",
  );
});

// --- Derivative correctness tests for smooth squash functions ---

Deno.test("squashDerivative LOGISTIC is sigmoid(x)*(1-sigmoid(x))", () => {
  const x = 0.7;
  const y = 1 / (1 + Math.exp(-x));
  const r = squashDerivative("LOGISTIC", x);
  assert(r.d != null);
  approx(r.d!, y * (1 - y), 1e-12);
  assert(r.nonSmooth === false);
});

Deno.test("squashDerivative IDENTITY is always 1", () => {
  for (const x of [-10, 0, 5.5]) {
    const r = squashDerivative("IDENTITY", x);
    assert(r.d === 1, `Expected d=1 at x=${x}`);
    assert(r.nonSmooth === false);
  }
});

Deno.test("squashDerivative RELU is 1 for positive, 0 for negative", () => {
  const pos = squashDerivative("RELU", 2);
  assert(pos.d === 1);
  const neg = squashDerivative("RELU", -1);
  assert(neg.d === 0);
  assert(pos.nonSmooth === true);
});

Deno.test("squashDerivative SELU matches standard SELU constants", () => {
  const lambda = 1.0507009873554805;
  const alpha = 1.6732632423543772;

  // Positive region: d = lambda
  const pos = squashDerivative("SELU", 2);
  assert(pos.d != null);
  approx(pos.d!, lambda, 1e-12);

  // Negative region: d = lambda * alpha * exp(x)
  const x = -0.5;
  const neg = squashDerivative("SELU", x);
  assert(neg.d != null);
  approx(neg.d!, lambda * alpha * Math.exp(x), 1e-12);
});

Deno.test("squashDerivative GELU derivative is correct at x=0", () => {
  // At x=0, GELU(0)=0 and GELU'(0)=0.5 (by symmetry of the CDF).
  const r = squashDerivative("GELU", 0);
  assert(r.d != null);
  approx(r.d!, 0.5, 1e-6);
  assert(r.nonSmooth === false);
});

Deno.test("squashDerivative SOFTPLUS is logistic(x)", () => {
  const x = 1.5;
  const expected = 1 / (1 + Math.exp(-x));
  const r = squashDerivative("Softplus", x);
  assert(r.d != null);
  approx(r.d!, expected, 1e-12);
});

Deno.test("squashDerivative SOFTSIGN is 1/(1+|x|)^2", () => {
  const x = -2;
  const denom = 1 + Math.abs(x);
  const expected = 1 / (denom * denom);
  const r = squashDerivative("SOFTSIGN", x);
  assert(r.d != null);
  approx(r.d!, expected, 1e-12);
});

Deno.test("squashDerivative GAUSSIAN is -2x*exp(-x^2)", () => {
  const x = 0.5;
  const expected = -2 * x * Math.exp(-x * x);
  const r = squashDerivative("GAUSSIAN", x);
  assert(r.d != null);
  approx(r.d!, expected, 1e-12);
});

Deno.test("squashDerivative ELU matches expected values", () => {
  // Positive region: d = 1
  const pos = squashDerivative("ELU", 3);
  assert(pos.d === 1);

  // Negative region: d = alpha * exp(x), alpha = 1
  const x = -1;
  const neg = squashDerivative("ELU", x);
  assert(neg.d != null);
  approx(neg.d!, Math.exp(x), 1e-12);
});

Deno.test("squashDerivative MISH derivative is finite across range", () => {
  // Mish is smooth; verify derivative is finite and reasonable across a range.
  for (const x of [-5, -1, 0, 1, 5]) {
    const r = squashDerivative("Mish", x);
    assert(r.d != null, `Mish derivative should not be null at x=${x}`);
    assert(Number.isFinite(r.d!), `Mish derivative should be finite at x=${x}`);
    assert(r.nonSmooth === false);
  }

  // At x=0, Mish'(0) = tanh(ln2) + 0 = tanh(ln2) ≈ 0.6
  const r0 = squashDerivative("Mish", 0);
  assert(r0.d != null);
  approx(r0.d!, Math.tanh(Math.log(2)), 1e-9);
});

Deno.test("squashDerivative COSINE is -sin(x)", () => {
  const x = 1.2;
  const r = squashDerivative("Cosine", x);
  assert(r.d != null);
  approx(r.d!, -Math.sin(x), 1e-12);
});

Deno.test("summariseSeriesStats handles empty and non-finite values", async () => {
  const { summariseSeriesStats } = (await import(
    "../docs/impact_diagnostics.js"
  )) as unknown as {
    summariseSeriesStats: (
      arr: number[],
      opts?: { sampleSize?: number },
    ) => { n: number; mean: number; min: number; max: number };
  };

  // Empty array returns zeros.
  const empty = summariseSeriesStats([]);
  assert(empty.n === 0);
  approx(empty.mean, 0, 1e-12);

  // Non-finite values are skipped.
  const withNaN = summariseSeriesStats([1, NaN, Infinity, 3]);
  assert(
    withNaN.n === 2,
    `Expected n=2 (finite values only), got ${withNaN.n}`,
  );
  approx(withNaN.mean, 2, 1e-12);
  approx(withNaN.min, 1, 1e-12);
  approx(withNaN.max, 3, 1e-12);
});

Deno.test("summariseDeadZoneStats detects RELU6 clamped regions", async () => {
  const mod =
    (await import("../docs/impact_diagnostics.js")) as unknown as Record<
      string,
      // deno-lint-ignore no-explicit-any
      any
    >;
  const summariseDeadZoneStats = mod.summariseDeadZoneStats as (
    squash: string,
    preActs: number[],
  ) => {
    n: number;
    fracClamped: number | null;
    fracAtZero: number | null;
  };

  // RELU6 clamps outside [0, 6].
  const relu6 = summariseDeadZoneStats("RELU6", [-1, 0, 3, 6, 7]);
  assert(relu6.n === 5);
  // Clamped: -1 (<=0), 0 (<=0), 6 (>=6), 7 (>=6) => 4/5
  approx(relu6.fracClamped ?? 0, 4 / 5, 1e-12);
  // RELU6 does not report fracAtZero.
  assert(relu6.fracAtZero === null, "RELU6 should not report fracAtZero");
});
