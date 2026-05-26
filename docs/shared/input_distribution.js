/**
 * Input-distribution primitives — auto-derive regime thresholds from each
 * input neuron's recorded activation distribution rather than hard-coding
 * magic constants.
 *
 * Issue #271 — consumed by the influence calc's min-gate awareness so
 * thresholds (e.g. "very low volume") flow from the snapshot data.
 *
 * Australian English note:
 * - Use spellings like "colour", "behaviour", "normalise".
 *
 * Last updated: 27-May-2026
 */

/**
 * @typedef {object} DistributionSummary
 * @property {number} min  Smallest finite value (0 when count===0).
 * @property {number} max  Largest finite value  (0 when count===0).
 * @property {number} p05  5th percentile (linear interpolation, type-7).
 * @property {number} p25  25th percentile.
 * @property {number} p50  Median.
 * @property {number} p75  75th percentile.
 * @property {number} p95  95th percentile.
 * @property {number} count  Number of finite samples retained (capped at MAX_SAMPLES).
 */

/**
 * Hard cap on the number of samples retained for quantile computation.
 * Matches the sampling pattern used elsewhere in the codebase
 * (see `docs/graph/graph.js::sampleEvenly`) so this primitive scales
 * predictably even for very long activation series.
 */
const MAX_SAMPLES = 2048;

/**
 * Empty / all-non-finite fallback. Returned values are finite so downstream
 * consumers can use them without guarding against NaN.
 *
 * @type {DistributionSummary}
 */
const EMPTY_SUMMARY = Object.freeze({
  min: 0,
  max: 0,
  p05: 0,
  p25: 0,
  p50: 0,
  p75: 0,
  p95: 0,
  count: 0,
});

/**
 * Sample an array evenly down to `maxN` points. Mirrors the pattern in
 * `docs/graph/graph.js` — copied here rather than imported because that file
 * is a browser-only DOM module and we want this primitive to remain pure
 * (and Deno-testable).
 *
 * @param {ArrayLike<number>} arr
 * @param {number} maxN
 * @returns {number[]}
 */
function sampleEvenly(arr, maxN) {
  if (!arr || typeof arr.length !== "number" || arr.length === 0) return [];
  const cap = Math.max(1, Math.floor(maxN));
  if (arr.length <= cap) {
    // Copy into a plain array so the caller can sort safely.
    const out = new Array(arr.length);
    for (let i = 0; i < arr.length; i++) out[i] = arr[i];
    return out;
  }
  const step = arr.length / cap;
  const out = new Array(cap);
  for (let i = 0; i < cap; i++) {
    const idx = Math.min(arr.length - 1, Math.floor(i * step));
    out[i] = arr[idx];
  }
  return out;
}

/**
 * Linear-interpolation quantile (R's type-7, NumPy default) on a
 * **sorted** array of finite numbers.
 *
 * @param {number[]} sorted
 * @param {number} q  Quantile in [0, 1].
 * @returns {number}
 */
function quantileSorted(sorted, q) {
  const n = sorted.length;
  if (n === 0) return 0;
  if (n === 1) return sorted[0];
  const pos = q * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  const frac = pos - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
}

/**
 * Summarise a numeric series into min/max and the standard five-quantile
 * fingerprint. Filters out non-finite values, samples evenly down to
 * MAX_SAMPLES, then computes quantiles by sorting in place.
 *
 * @param {ArrayLike<number>|null|undefined} values
 * @returns {DistributionSummary}
 */
export function summariseInputDistribution(values) {
  if (!values || typeof values.length !== "number" || values.length === 0) {
    return { ...EMPTY_SUMMARY };
  }

  // Sample first (cheap), then filter for finite values.
  const sampled = sampleEvenly(values, MAX_SAMPLES);
  const finite = [];
  for (const v of sampled) {
    if (typeof v === "number" && Number.isFinite(v)) finite.push(v);
  }
  if (finite.length === 0) return { ...EMPTY_SUMMARY };

  finite.sort((a, b) => a - b);
  return {
    min: finite[0],
    max: finite[finite.length - 1],
    p05: quantileSorted(finite, 0.05),
    p25: quantileSorted(finite, 0.25),
    p50: quantileSorted(finite, 0.5),
    p75: quantileSorted(finite, 0.75),
    p95: quantileSorted(finite, 0.95),
    count: finite.length,
  };
}

/** Quantile keys exposed by {@link summariseInputDistribution}. */
const SUMMARY_QUANTILE_KEYS = new Set([
  "p05",
  "p25",
  "p50",
  "p75",
  "p95",
]);

/**
 * Derive a "low regime" threshold from a distribution summary — the value
 * below which an input is considered very low for this dataset.
 *
 * Default rule: return the 5th percentile so the threshold flows from the
 * data rather than a hard-coded constant.
 *
 * @param {DistributionSummary} summary
 * @param {{ regimeQuantile?: string }} [opts]
 * @returns {number}
 */
export function deriveLowRegimeThreshold(summary, opts) {
  const key = opts?.regimeQuantile ?? "p05";
  if (SUMMARY_QUANTILE_KEYS.has(key)) {
    return summary[key];
  }
  // Unknown override — fall back to the default rather than throwing,
  // so callers cannot accidentally crash the influence calc on a typo.
  return summary.p05;
}

/**
 * WeakMap cache: snapshot object → Map<inputUuid, DistributionSummary>.
 * A WeakMap means we never hold onto snapshots that have been replaced.
 *
 * @type {WeakMap<object, Map<string, DistributionSummary>>}
 */
const SNAPSHOT_CACHE = new WeakMap();

/**
 * Build a per-input distribution summary for every input neuron in the
 * normalised creature, keyed by neuron UUID. Cached on the snapshot
 * reference so subsequent influence calls in the same session pay the
 * sort/quantile cost only once.
 *
 * @param {object} snapshot  The raw snapshot object — its identity is the
 *   cache key, so callers must pass the same reference on each call.
 * @param {Map<string, {uuid: string, type?: string}>} neuronsByUuid
 *   The normalised neuron map (see `normaliseCreature`).
 * @returns {Map<string, DistributionSummary>}
 */
export function buildInputDistributionMap(snapshot, neuronsByUuid) {
  if (snapshot && typeof snapshot === "object") {
    const cached = SNAPSHOT_CACHE.get(snapshot);
    if (cached) return cached;
  }

  /** @type {Map<string, DistributionSummary>} */
  const out = new Map();
  const recordingNeurons = snapshot?.recording?.neurons ?? {};

  for (const neuron of neuronsByUuid.values()) {
    const t = String(neuron?.type ?? "").toLowerCase();
    if (t !== "input") continue;
    const rec = recordingNeurons[neuron.uuid];
    const activation = Array.isArray(rec?.activation) ? rec.activation : null;
    out.set(neuron.uuid, summariseInputDistribution(activation));
  }

  if (snapshot && typeof snapshot === "object") {
    SNAPSHOT_CACHE.set(snapshot, out);
  }
  return out;
}
