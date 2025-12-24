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
