function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function approx(actual: number, expected: number, tol = 1e-9): void {
  if (Math.abs(actual - expected) > tol) {
    throw new Error(`Expected ~${expected} but got ${actual}`);
  }
}

import {
  computeGradientProxyImpact,
  computeOutgoingProxyTerms,
  computePreActivations,
  computeSquashDerivativeStats,
  squashDerivative,
} from "../impact_diagnostics.js";

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
  const mod = await import("../impact_diagnostics.js") as unknown as Record<
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
