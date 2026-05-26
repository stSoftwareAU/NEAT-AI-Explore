/**
 * Squash-family emit ceilings.
 *
 * The viewer attributes per-synapse contribution to a downstream neuron, but a
 * neuron's activation can never exceed what its squash function is able to
 * emit. Without that cap the attribution overstates influence whenever the
 * receiving neuron is saturated — see issue #266.
 *
 * `squashEmitCeiling(squash, recordedActivationMax?)` returns the maximum
 * absolute value that a neuron with the given squash can emit. For families
 * that have no analytic ceiling (RELU, LEAKY_RELU, IDENTITY) the function
 * falls back to `recordedActivationMax` when supplied, and finally to
 * `Number.POSITIVE_INFINITY` so callers know the value is effectively
 * unbounded.
 *
 * Unknown or missing squash strings return `Number.POSITIVE_INFINITY` so
 * callers gracefully fall back to current (uncapped) behaviour. Nothing is
 * logged — the helper is meant to be a quiet utility, not a diagnostic source.
 */

/**
 * Squash families with bounded output magnitude.
 *
 * Key: upper-cased squash identifier. Value: |emit| ceiling.
 */
const BOUNDED_CEILINGS = Object.freeze({
  // Symmetric ±1
  TANH: 1,
  HARD_TANH: 1,
  BIPOLAR: 1,
  BIPOLAR_SIGMOID: 1,
  // Asymmetric 0..1
  SIGMOID: 1,
  LOGISTIC: 1,
  LOGSIG: 1,
  STEP: 1,
  // Softer bounded squashes
  SOFTSIGN: 1,
  GAUSSIAN: 1,
});

/**
 * Squash families with no analytic upper bound — fall back to
 * `recordedActivationMax` if supplied, otherwise `Infinity`.
 */
const UNBOUNDED_FAMILIES = Object.freeze(
  new Set([
    "IDENTITY",
    "RELU",
    "LEAKY_RELU",
    "PRELU",
    "ELU",
    "SELU",
    "SOFTPLUS",
    "SWISH",
    "MISH",
  ]),
);

/**
 * Compute the effective emit ceiling for a squash function.
 *
 * @param {string | null | undefined} squash Squash identifier (case-insensitive).
 * @param {number | null | undefined} [recordedActivationMax]
 *   Optional recorded maximum activation magnitude from the snapshot. Used as
 *   the ceiling for unbounded squashes (e.g. RELU/IDENTITY) so attribution can
 *   still respect an observed envelope.
 * @returns {number} The non-negative ceiling. `Number.POSITIVE_INFINITY` when
 *   the squash is unknown/missing and no recorded maximum is provided.
 */
export function squashEmitCeiling(squash, recordedActivationMax) {
  const key = typeof squash === "string" ? squash.trim().toUpperCase() : "";
  if (key && Object.prototype.hasOwnProperty.call(BOUNDED_CEILINGS, key)) {
    return BOUNDED_CEILINGS[key];
  }

  if (
    typeof recordedActivationMax === "number" &&
    isFinite(recordedActivationMax) &&
    recordedActivationMax > 0
  ) {
    // Even for bounded squashes, recordedActivationMax can be a tighter cap if
    // the network never saturates. We only reach here for unbounded or unknown
    // squashes, so the recorded envelope is the best estimate available.
    return recordedActivationMax;
  }

  if (key && UNBOUNDED_FAMILIES.has(key)) {
    return Number.POSITIVE_INFINITY;
  }

  // Unknown squash, no recorded envelope — fall back gracefully.
  return Number.POSITIVE_INFINITY;
}
