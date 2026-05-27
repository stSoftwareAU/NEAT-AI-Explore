/**
 * Consumer-contract schema + helpers.
 *
 * Issue #272 — some downstream consumers combine several inputs through a
 * `min(...)` (or similar) gate before the output is acted on. The viewer's
 * influence calc has no way to know about this on its own, so the consumer
 * supplies a *contract* describing each gate. The calc then credits an input
 * with influence only on the samples where its value would actually have
 * driven the gate.
 *
 * Example contract:
 *
 * ```json
 * {
 *   "gates": [
 *     {
 *       "kind": "min",
 *       "inputs": ["input-volume", "input-rsi"],
 *       "regimeQuantile": "p05"
 *     }
 *   ]
 * }
 * ```
 *
 * The contract may be embedded in the snapshot under
 * `creature.consumerContract`, or loaded from a sibling `.contract.json` file
 * and passed in via {@link loadConsumerContract}'s second argument.
 *
 * Australian English note: prefer spellings like "behaviour", "colour".
 *
 * Last updated: 27-May-2026
 */

/**
 * @typedef {object} Gate
 * @property {"min"} kind  Gate operator (only `min` is supported for now).
 * @property {string[]} inputs  Neuron UUIDs combined by the gate. Order is
 *   not significant. Duplicates are collapsed.
 * @property {string} [regimeQuantile]  Quantile key used to derive the
 *   "low regime" threshold for diagnostic surfacing (defaults to `"p05"`).
 *   The gate decision itself is the per-sample minimum across `inputs`,
 *   independent of this quantile — see {@link computeInputActiveFraction}.
 */

/**
 * @typedef {object} ConsumerContract
 * @property {Gate[]} gates  Normalised, validated gate descriptors.
 * @property {Map<string, number[]>} activationsByUuid  Per-input activation
 *   series sourced from `snapshot.recording.neurons[uuid].activation`. Only
 *   inputs referenced by at least one gate are cached.
 */

/** Gate kinds the calc knows how to interpret. */
const SUPPORTED_KINDS = new Set(["min"]);

/**
 * Validate and normalise a raw gate descriptor. Returns `null` when the
 * descriptor is unusable (unknown kind, fewer than two inputs).
 *
 * @param {unknown} raw
 * @returns {Gate | null}
 */
function normaliseGate(raw) {
  if (!raw || typeof raw !== "object") return null;
  const kind = String(/** @type {{kind?: unknown}} */ (raw).kind ?? "")
    .toLowerCase();
  if (!SUPPORTED_KINDS.has(kind)) return null;

  const rawInputs = /** @type {{inputs?: unknown}} */ (raw).inputs;
  const inputs = Array.isArray(rawInputs)
    ? rawInputs.filter((u) => typeof u === "string" && u.length > 0)
    : [];
  // Collapse duplicates while preserving first-seen order.
  const dedup = Array.from(new Set(inputs));
  if (dedup.length < 2) return null;

  const rq = /** @type {{regimeQuantile?: unknown}} */ (raw).regimeQuantile;
  const regimeQuantile = typeof rq === "string" && rq.length > 0 ? rq : "p05";

  return { kind: /** @type {"min"} */ (kind), inputs: dedup, regimeQuantile };
}

/**
 * Load and validate a consumer contract for the given snapshot.
 *
 * Resolution order:
 *   1. The explicit `contractJson` argument, when truthy.
 *   2. The embedded `snapshot.creature.consumerContract`, when present.
 *
 * Returns `null` when no usable contract is found (no gates, or all gates
 * are invalid). The returned object bundles the validated gate descriptors
 * with a cache of the per-input activation series so consumers can compute
 * gate-masking fractions without re-reading the snapshot on every call.
 *
 * @param {object | null | undefined} snapshot
 * @param {unknown} [contractJson]
 * @returns {ConsumerContract | null}
 */
export function loadConsumerContract(snapshot, contractJson) {
  const raw = contractJson != null && contractJson !== ""
    ? contractJson
    : /** @type {{creature?: {consumerContract?: unknown}}} */ (snapshot)
      ?.creature?.consumerContract ?? null;
  if (!raw || typeof raw !== "object") return null;

  const rawGates = /** @type {{gates?: unknown}} */ (raw).gates;
  if (!Array.isArray(rawGates)) return null;

  const gates = [];
  for (const g of rawGates) {
    const norm = normaliseGate(g);
    if (norm) gates.push(norm);
  }
  if (gates.length === 0) return null;

  /** @type {Map<string, number[]>} */
  const activationsByUuid = new Map();
  const recordingNeurons =
    /** @type {{recording?: {neurons?: Record<string, {activation?: unknown}>}}} */ (
      snapshot
    )?.recording?.neurons ?? {};
  for (const g of gates) {
    for (const uuid of g.inputs) {
      if (activationsByUuid.has(uuid)) continue;
      const rec = recordingNeurons[uuid];
      const arr = Array.isArray(rec?.activation) ? rec.activation : null;
      if (arr) activationsByUuid.set(uuid, arr);
    }
  }
  return { gates, activationsByUuid };
}

/**
 * Return the subset of `contract.gates` that reference `inputUuid`.
 *
 * @param {ConsumerContract | null | undefined} contract
 * @param {string} inputUuid
 * @returns {Gate[]}
 */
export function getGatesForInput(contract, inputUuid) {
  if (!contract || !Array.isArray(contract.gates)) return [];
  if (typeof inputUuid !== "string" || inputUuid.length === 0) return [];
  return contract.gates.filter((g) => g.inputs.includes(inputUuid));
}

/**
 * Compute the fraction of samples in which `inputUuid` is the strict minimum
 * across every gate it participates in.
 *
 * Semantics:
 * - For each sample index `i`, the input is considered "active" iff for every
 *   gate containing it, `selfArr[i] < otherArr[i]` for every other operand
 *   in that gate.
 * - Returns `1.0` when no gates reference the input (no masking applies).
 * - Returns `1.0` when no gate operand has usable recording (the gate cannot
 *   be evaluated, so we conservatively leave influence unmasked rather than
 *   silently zeroing it out).
 * - NaN/Infinity samples in either array are skipped (do not count toward
 *   the active total).
 *
 * The length used for the denominator is the minimum of the referenced
 * activation arrays — this protects against ragged recordings.
 *
 * @param {ConsumerContract | null | undefined} contract
 * @param {string} inputUuid
 * @returns {number}  Active fraction in [0, 1].
 */
export function computeInputActiveFraction(contract, inputUuid) {
  if (!contract) return 1;
  const gates = getGatesForInput(contract, inputUuid);
  if (gates.length === 0) return 1;

  const selfArr = contract.activationsByUuid?.get(inputUuid);
  if (!Array.isArray(selfArr) || selfArr.length === 0) return 1;

  // Collect per-gate other-operand arrays. Skip gates with no evaluable other
  // operand (e.g. the contract references an input not present in the snapshot).
  /** @type {number[][][]} */
  const evaluable = [];
  for (const g of gates) {
    /** @type {number[][]} */
    const others = [];
    for (const u of g.inputs) {
      if (u === inputUuid) continue;
      const arr = contract.activationsByUuid?.get(u);
      if (Array.isArray(arr) && arr.length > 0) others.push(arr);
    }
    if (others.length > 0) evaluable.push(others);
  }
  if (evaluable.length === 0) return 1;

  // The denominator is bounded by the shortest referenced array so we never
  // index past the end.
  let len = selfArr.length;
  for (const others of evaluable) {
    for (const arr of others) {
      if (arr.length < len) len = arr.length;
    }
  }
  if (len === 0) return 1;

  let active = 0;
  for (let i = 0; i < len; i++) {
    const v = selfArr[i];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;

    let isMinAcrossAllGates = true;
    for (const others of evaluable) {
      let isMinThisGate = true;
      for (const arr of others) {
        const w = arr[i];
        if (typeof w !== "number" || !Number.isFinite(w)) {
          isMinThisGate = false;
          break;
        }
        if (!(v < w)) {
          isMinThisGate = false;
          break;
        }
      }
      if (!isMinThisGate) {
        isMinAcrossAllGates = false;
        break;
      }
    }
    if (isMinAcrossAllGates) active++;
  }
  return active / len;
}
