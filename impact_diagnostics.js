/**
 * Impact diagnostics (viewer-side heuristics).
 *
 * Goal:
 * - Provide evidence when exported `derived.impactsByNeuronUuid` appears
 *   inconsistent, especially for non-smooth squashes (IF/MIN/MAX/etc).
 *
 * What we compute:
 * - Pre-activation per neuron per sample: bias + Σ(contribution_inbound)
 * - Squash derivative stats: mean|d|, fraction near 0 (saturation-ish), and
 *   "non-smooth" warnings for squashes where a derivative is not well-defined.
 * - A gradient-style proxy influence from each neuron to outputs via a bounded
 *   reverse message passing pass:
 *     sens[from] += sens[to] * |weight| * mean|d_squash(to_preAct)|
 *
 * Notes:
 * - This is NOT the production impact metric. It's a diagnostic signal only.
 * - For recurrent graphs, we use a bounded iteration count and treat the
 *   recorded activations as a fixed point; this is still only a heuristic.
 */

/**
 * @typedef {{ fromUuid: string, toUuid: string, weight: number }} Synapse
 */

/**
 * @param {unknown} x
 * @returns {x is number[]}
 */
function isNumberArray(x) {
  return Array.isArray(x) &&
    x.every((v) => typeof v === "number" && isFinite(v));
}

/**
 * @param {number[]} arr
 * @returns {{ meanAbs: number, fracNearZero: number, n: number }}
 */
function summariseDerivative(arr) {
  if (!arr || arr.length === 0) return { meanAbs: 0, fracNearZero: 1, n: 0 };
  let sumAbs = 0;
  let near0 = 0;
  for (const v of arr) {
    const a = Math.abs(v);
    sumAbs += a;
    if (a < 1e-6) near0 += 1;
  }
  return {
    meanAbs: sumAbs / arr.length,
    fracNearZero: near0 / arr.length,
    n: arr.length,
  };
}

/**
 * Basic squashes + derivatives. Where we don't know the precise NEAT-AI
 * behaviour, we keep it conservative and mark as non-smooth/unknown.
 *
 * @param {string} squash
 * @param {number} x pre-activation
 * @returns {{ d: number | null, nonSmooth: boolean, note?: string }}
 */
export function squashDerivative(squash, x) {
  const s = String(squash ?? "IDENTITY").toUpperCase();

  switch (s) {
    case "IDENTITY":
      return { d: 1, nonSmooth: false };
    case "TANH": {
      const t = Math.tanh(x);
      return { d: 1 - t * t, nonSmooth: false };
    }
    case "LOGISTIC": {
      const y = 1 / (1 + Math.exp(-x));
      return { d: y * (1 - y), nonSmooth: false };
    }
    case "BIPOLAR_SIGMOID": {
      // f(x) = 2/(1+exp(-x)) - 1 ; f'(x) = (1 - f(x)^2)/2
      const y = 2 / (1 + Math.exp(-x)) - 1;
      return { d: (1 - y * y) / 2, nonSmooth: false };
    }
    case "HARD_TANH": {
      // Typical hard-tanh clamp to [-1, 1]
      if (x <= -1 || x >= 1) return { d: 0, nonSmooth: true, note: "clamped" };
      return { d: 1, nonSmooth: true, note: "piecewise" };
    }
    case "CLIPPED": {
      // Alias for HARD_TANH in NEAT-AI.
      if (x <= -1 || x >= 1) return { d: 0, nonSmooth: true, note: "clamped" };
      return { d: 1, nonSmooth: true, note: "piecewise" };
    }
    case "RELU":
      return { d: x > 0 ? 1 : 0, nonSmooth: true, note: "kink at 0" };
    case "LEAKYRELU":
      return { d: x > 0 ? 1 : 0.01, nonSmooth: true, note: "kink at 0" };
    case "RELU6": {
      // f(x)=clamp(x, 0, 6). Discontinuous derivative at 0 and 6.
      if (x <= 0 || x >= 6) return { d: 0, nonSmooth: true, note: "clamped" };
      return { d: 1, nonSmooth: true, note: "piecewise" };
    }
    case "ELU": {
      const a = 1;
      return {
        d: x >= 0 ? 1 : a * Math.exp(x),
        nonSmooth: true,
        note: "kink at 0",
      };
    }
    case "SELU": {
      // Standard SELU: scale * (x if x>0 else alpha*(exp(x)-1))
      const lambda = 1.0507009873554805;
      const alpha = 1.6732632423543772;
      return {
        d: x >= 0 ? lambda : lambda * alpha * Math.exp(x),
        nonSmooth: true,
        note: "kink at 0",
      };
    }
    case "SOFTPLUS": {
      // d/dx log(1+exp(x)) = logistic(x)
      const y = 1 / (1 + Math.exp(-x));
      return { d: y, nonSmooth: false };
    }
    case "SOFTSIGN": {
      // f(x) = x / (1 + |x|) ; f'(x) = 1 / (1 + |x|)^2
      const denom = 1 + Math.abs(x);
      return { d: 1 / (denom * denom), nonSmooth: false };
    }
    case "ARCTAN":
    case "ARCTANH":
    case "ARCTAN_": {
      return { d: 1 / (1 + x * x), nonSmooth: false };
    }
    case "COSINE":
      return { d: -Math.sin(x), nonSmooth: false };
    case "SINE":
    case "SINUSOID":
      return { d: Math.cos(x), nonSmooth: false };
    case "TAN": {
      // f(x)=tan(x) ; f'(x)=sec^2(x)=1/cos^2(x)
      const c = Math.cos(x);
      if (Math.abs(c) < 1e-12) {
        return { d: null, nonSmooth: true, note: "singular near asymptote" };
      }
      return {
        d: 1 / (c * c),
        nonSmooth: true,
        note: "singular near asymptote",
      };
    }
    case "ABSOLUTE":
    case "ABS": {
      // |x| ; derivative is sign(x) except at 0 (undefined).
      if (x === 0) return { d: null, nonSmooth: true, note: "kink at 0" };
      return { d: x > 0 ? 1 : -1, nonSmooth: true, note: "kink at 0" };
    }
    case "SQRT": {
      // Interpreted as sqrt(max(0, x)). If NEAT-AI uses sqrt(|x|), this will
      // still flag the risky region near 0 / negative pre-activations.
      if (x <= 0) {
        return { d: null, nonSmooth: true, note: "undefined for x≤0" };
      }
      return {
        d: 1 / (2 * Math.sqrt(x)),
        nonSmooth: true,
        note: "singular near 0",
      };
    }
    case "EXPONENTIAL":
    case "EXP": {
      // exp(x)
      // Cap extreme x to avoid Infinity in diagnostics.
      const xx = Math.max(-50, Math.min(50, x));
      return { d: Math.exp(xx), nonSmooth: false };
    }
    case "LOGSIGMOID": {
      // log(sigmoid(x)) ; d/dx = 1 - sigmoid(x) = sigmoid(-x)
      const y = 1 / (1 + Math.exp(x));
      return { d: y, nonSmooth: false };
    }
    case "COMPLEMENT":
    case "INVERSE":
      // Common meaning: 1 - x
      return { d: -1, nonSmooth: false };
    case "BENT_IDENTITY": {
      // f(x)= (sqrt(x^2+1)-1)/2 + x ; f'(x)= x/(2*sqrt(x^2+1)) + 1
      return { d: 1 + x / (2 * Math.sqrt(x * x + 1)), nonSmooth: false };
    }
    case "CUBE":
      // f(x)=x^3 ; f'(x)=3x^2
      return { d: 3 * x * x, nonSmooth: false };
    case "SQUARE":
      // f(x)=x^2 ; f'(x)=2x
      return { d: 2 * x, nonSmooth: false };
    case "GAUSSIAN": {
      // f(x)=exp(-x^2) ; f'(x)=-2x*exp(-x^2)
      const xx = Math.max(-100, Math.min(100, x));
      return { d: -2 * xx * Math.exp(-xx * xx), nonSmooth: false };
    }
    case "ISRU": {
      // f(x)= x / sqrt(1 + αx^2) ; f'(x) = (1 + αx^2)^(-3/2), α=1
      const denom = 1 + x * x;
      return { d: Math.pow(denom, -1.5), nonSmooth: false };
    }
    case "SWISH": {
      // Swish (SiLU): f(x)=x*sigmoid(x) ; f'(x) = sigmoid(x) + x*sigmoid(x)*(1-sigmoid(x))
      const sig = 1 / (1 + Math.exp(-x));
      return { d: sig + x * sig * (1 - sig), nonSmooth: false };
    }
    case "GELU": {
      // Approx GELU derivative, matching NEAT-AI's implementation:
      // f(x) = 0.5*x*(1+tanh(√(2/π) * (x + 0.044715*x^3)))
      // f'(x) = cdf + pdf (see NEAT-AI GELU.derivative)
      const inner = Math.sqrt(2 / Math.PI) * (x + 0.044715 * Math.pow(x, 3));
      const tanhInner = Math.tanh(inner);
      const cdf = 0.5 * (1 + tanhInner);
      const pdf = (0.5 * x * (1 - tanhInner * tanhInner)) *
        Math.sqrt(2 / Math.PI) *
        (1 + 3 * 0.044715 * x * x);
      const d = cdf + pdf;
      return { d: Number.isFinite(d) ? d : 0, nonSmooth: false };
    }
    case "MISH": {
      // d/dx [ x * tanh(softplus(x)) ]
      // Implement numerically stable-ish formula using exp.
      const ex = Math.exp(x);
      const sp = Math.log1p(ex);
      const tsp = Math.tanh(sp);
      const sig = ex / (1 + ex);
      // d = tsp + x * (1 - tsp^2) * sig
      return { d: tsp + x * (1 - tsp * tsp) * sig, nonSmooth: false };
    }
    case "STDINVERSE": {
      // NOTE: NEAT-AI's StdInverse class has historical inconsistency between
      // squash and derivative. For diagnostics, we mirror its derivative:
      // f'(x) = -sign(x) / (1 + |x|)^2
      if (x === 0) return { d: null, nonSmooth: true, note: "kink at 0" };
      const denom = 1 + Math.abs(x);
      return {
        d: -Math.sign(x) / (denom * denom),
        nonSmooth: true,
        note: "kink at 0",
      };
    }
    case "HYPOT":
    case "HYPOTV2":
    case "MEAN":
      // These are aggregator-style activations (not a simple scalar squash of a
      // pre-activation). The viewer's pre-activation reconstruction model doesn't
      // apply cleanly.
      return { d: null, nonSmooth: true, note: "unsupported activation model" };
    case "MIN":
    case "MINIMUM":
    case "MAX":
    case "MAXIMUM":
    case "IF":
    case "BIPOLAR":
    case "STEP":
      return { d: null, nonSmooth: true, note: "non-smooth/branching" };
    default:
      return { d: null, nonSmooth: true, note: "unknown squash" };
  }
}

/**
 * Explain the gradient-proxy "working" for a neuron's outgoing synapses.
 *
 * term = sens(to) * |weight| * mean|d_squash(to)|
 *
 * @param {{
 *   fromUuid: string,
 *   synapses: Synapse[],
 *   neuronsByUuid: Map<string, { uuid: string, type?: string, squash?: string }>,
 *   proxySens: Map<string, number>,
 *   squashStats: Map<string, { meanAbsD: number, nonSmooth: boolean, note?: string }>
 * }} input
 * @returns {Array<{
 *   toUuid: string,
 *   weight: number,
 *   toSquash: string,
 *   toMeanAbsD: number | null,
 *   toNonSmooth: boolean,
 *   toNote?: string,
 *   toSens: number | null,
 *   term: number | null
 * }>}
 */
export function computeOutgoingProxyTerms(input) {
  const { fromUuid, synapses, neuronsByUuid, proxySens, squashStats } = input ??
    {};
  if (
    !fromUuid || !Array.isArray(synapses) || !neuronsByUuid || !proxySens ||
    !squashStats
  ) return [];

  const outs = synapses.filter((s) => s.fromUuid === fromUuid);
  return outs.map((s) => {
    const to = s.toUuid;
    const n = neuronsByUuid.get(to);
    const toSquash = (n?.squash ?? "IDENTITY").toString();
    const st = squashStats.get(to);
    const toMeanAbsD = st ? st.meanAbsD : null;
    const toNonSmooth = st ? !!st.nonSmooth : false;
    const toNote = st?.note;
    const toSens = proxySens.get(to);
    const term = typeof toSens === "number" && typeof toMeanAbsD === "number"
      ? toSens * Math.abs(s.weight) * toMeanAbsD
      : null;
    return {
      toUuid: to,
      weight: s.weight,
      toSquash,
      toMeanAbsD,
      toNonSmooth,
      toNote,
      toSens: typeof toSens === "number" ? toSens : null,
      term,
    };
  }).sort((a, b) => (b.term ?? 0) - (a.term ?? 0));
}

/**
 * Compute pre-activation arrays for neurons from derived synapse contributions.
 *
 * @param {{
 *   neuronsByUuid: Map<string, { uuid: string, bias?: number, type?: string, squash?: string }>,
 *   synapses: Synapse[],
 *   derivedSynapses: Record<string, any>,
 *   recordingNeurons: Record<string, any>
 * }} input
 * @returns {Map<string, number[]>} uuid -> pre-activation (per sample)
 */
export function computePreActivations(input) {
  const { neuronsByUuid, synapses, derivedSynapses, recordingNeurons } =
    input ?? {};
  /** @type {Map<string, number[]>} */
  const pre = new Map();
  if (!neuronsByUuid || !synapses || !derivedSynapses || !recordingNeurons) {
    return pre;
  }

  // Derive sample count from any recorded neuron.
  let sampleCount = null;
  for (const [_uuid, rec] of Object.entries(recordingNeurons)) {
    const act = rec?.activation ?? rec?.Activation;
    if (isNumberArray(act)) {
      sampleCount = act.length;
      break;
    }
  }
  if (!sampleCount || sampleCount <= 0) return pre;

  // Initialise each non-input neuron with its bias (per sample).
  for (const [uuid, n] of neuronsByUuid.entries()) {
    if (!uuid || typeof uuid !== "string") continue;
    const type = (n?.type ?? "").toString();
    if (type === "input") continue;
    const bias = typeof n?.bias === "number" && isFinite(n.bias) ? n.bias : 0;
    pre.set(uuid, Array(sampleCount).fill(bias));
  }

  // Sum inbound contributions: derived.synapses["from→to"].contribution[...]
  for (const s of synapses) {
    const key = `${s.fromUuid}→${s.toUuid}`;
    const ds = derivedSynapses[key];
    const contrib = ds?.contribution;
    if (!isNumberArray(contrib)) continue;
    const arr = pre.get(s.toUuid);
    if (!arr) continue;
    for (let i = 0; i < sampleCount; i++) arr[i] += contrib[i];
  }

  return pre;
}

/**
 * Compute squash derivative summaries per neuron.
 *
 * @param {{
 *   neuronsByUuid: Map<string, { uuid: string, type?: string, squash?: string }>,
 *   preActivations: Map<string, number[]>
 * }} input
 * @returns {Map<string, { meanAbsD: number, fracNearZero: number, nonSmooth: boolean, note?: string }>}
 */
export function computeSquashDerivativeStats(input) {
  const { neuronsByUuid, preActivations } = input ?? {};
  /** @type {Map<string, { meanAbsD: number, fracNearZero: number, nonSmooth: boolean, note?: string }>} */
  const out = new Map();
  if (!neuronsByUuid || !preActivations) return out;

  for (const [uuid, n] of neuronsByUuid.entries()) {
    const type = (n?.type ?? "").toString();
    if (type === "input") continue;
    const pre = preActivations.get(uuid);
    if (!pre) continue;
    const squash = (n?.squash ?? "IDENTITY").toString();

    /** @type {number[]} */
    const ds = [];
    let nonSmooth = false;
    let note = undefined;

    for (const x of pre) {
      const r = squashDerivative(squash, x);
      if (r.nonSmooth) {
        nonSmooth = true;
        note = note ?? r.note;
      }
      if (typeof r.d === "number" && isFinite(r.d)) ds.push(r.d);
      else ds.push(0); // treat unknown derivative as 0 for saturation proxy
    }

    const s = summariseDerivative(ds);
    out.set(uuid, {
      meanAbsD: s.meanAbs,
      fracNearZero: s.fracNearZero,
      nonSmooth,
      note,
    });
  }

  return out;
}

/**
 * Gradient-style proxy influence to outputs.
 *
 * Returns a map uuid -> proxy score (bigger means "more influence").
 *
 * @param {{
 *   neuronsByUuid: Map<string, { uuid: string, type?: string, squash?: string }>,
 *   synapses: Synapse[],
 *   preActivations: Map<string, number[]>,
 *   outputUuids: string[],
 *   iterations?: number
 * }} input
 * @returns {Map<string, number>}
 */
export function computeGradientProxyImpact(input) {
  const {
    neuronsByUuid,
    synapses,
    preActivations,
    outputUuids,
    iterations = 8,
  } = input ?? {};
  /** @type {Map<string, number>} */
  const score = new Map();
  if (
    !neuronsByUuid || !synapses || !preActivations ||
    !Array.isArray(outputUuids)
  ) return score;

  // Precompute mean|d| for each to-node.
  const derivStats = computeSquashDerivativeStats({
    neuronsByUuid,
    preActivations,
  });
  const meanAbsDByUuid = new Map(
    Array.from(derivStats.entries()).map(([k, v]) => [k, v.meanAbsD]),
  );

  /** @type {Map<string, Synapse[]>} */
  const outgoing = new Map();
  for (const s of synapses) {
    if (!outgoing.has(s.fromUuid)) outgoing.set(s.fromUuid, []);
    outgoing.get(s.fromUuid).push(s);
  }

  // Initialise sensitivities.
  /** @type {Map<string, number>} */
  let sens = new Map();
  for (const [uuid, n] of neuronsByUuid.entries()) {
    if (!uuid) continue;
    const type = (n?.type ?? "").toString();
    if (type === "input") continue;
    sens.set(uuid, 0);
  }
  for (const out of outputUuids) sens.set(out, 1);

  // Iterate reverse message passing to handle cycles.
  for (let it = 0; it < iterations; it++) {
    /** @type {Map<string, number>} */
    const next = new Map(sens);
    for (const [from, outs] of outgoing.entries()) {
      let acc = next.get(from) ?? 0;
      for (const s of outs) {
        const to = s.toUuid;
        const toSens = sens.get(to) ?? 0;
        const d = meanAbsDByUuid.get(to) ?? 0;
        acc += toSens * Math.abs(s.weight) * d;
      }
      next.set(from, acc);
    }
    sens = next;
  }

  // Copy out, excluding outputs if desired later.
  for (const [uuid, v] of sens.entries()) {
    score.set(uuid, v);
  }

  return score;
}
