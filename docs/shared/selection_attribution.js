/**
 * Selection-squash attribution (Issue #513).
 *
 * MINIMUM / MAXIMUM / IF neurons *select* one operand per observation rather
 * than summing their inbound synapses. The default additive allocation
 * (`|meanContribution|`, fallback `|weight|`) therefore misattributes their
 * inbound share: a large-magnitude operand that almost never binds the
 * selection is credited ~all of the neuron's influence even though it rarely
 * drives the output.
 *
 * This module computes a *win fraction* per operand — the fraction of recorded
 * observations where that operand actually wins the selection:
 *
 *   - MINIMUM: operand is the argmin of `weight·activation` (contribution).
 *   - MAXIMUM: operand is the argmax of the contribution.
 *   - IF:      operand roles (condition vs positive/negative branch) are not
 *              identifiable from a plain snapshot, so we fall back to an even
 *              `1/n` split, flagged so the UI can surface a caveat.
 *
 * This mirrors NEAT-AI-Discovery's `compute_min_stats` / `compute_max_stats`
 * (per-operand win probability) so the viewer's display agrees with the
 * candidate-search ranking. It is a *viewer-only* change: training backprop
 * and Discovery focus ranking already attribute correctly.
 *
 * The module is intentionally DOM-free so it can be unit-tested under Deno.
 *
 * Australian English note: prefer spellings like "behaviour", "colour".
 */

/** Squash aliases the selection logic recognises, normalised to a canonical key. */
const SELECTION_SQUASHES = new Map([
  ["MIN", "MINIMUM"],
  ["MINIMUM", "MINIMUM"],
  ["MAX", "MAXIMUM"],
  ["MAXIMUM", "MAXIMUM"],
  ["IF", "IF"],
]);

/**
 * Normalise a squash string to a canonical selection kind, or `null` when the
 * squash is not a selection squash.
 *
 * @param {unknown} squash
 * @returns {("MINIMUM"|"MAXIMUM"|"IF"|null)}
 */
export function normaliseSelectionSquash(squash) {
  if (typeof squash !== "string") return null;
  return SELECTION_SQUASHES.get(squash.trim().toUpperCase()) ?? null;
}

/**
 * @param {unknown} squash
 * @returns {boolean} true when the squash selects a single operand per sample.
 */
export function isSelectionSquash(squash) {
  return normaliseSelectionSquash(squash) !== null;
}

/**
 * @typedef {object} SelectionOperand
 * @property {number[]|null} [contributions] — per-observation `weight·activation`
 *   series for this operand. When absent for any operand the helper falls back
 *   to an even split.
 */

/**
 * @typedef {object} SelectionWinResult
 * @property {("MINIMUM"|"MAXIMUM"|"IF"|null)} kind — canonical selection kind.
 * @property {number[]} shares — win fraction per operand (aligned to the input
 *   `operands` array); sums to ~1 when at least one operand is supplied.
 * @property {boolean} fallback — true when an even `1/n` split was used because
 *   per-observation contributions were unavailable (or the kind is `IF`).
 * @property {number} sampleCount — number of observations that contributed a
 *   (possibly fractional, on ties) win; 0 when the even-split fallback fired.
 */

/**
 * Compute per-operand win fractions for a selection neuron.
 *
 * Semantics:
 * - MINIMUM/MAXIMUM: for each observation the winner is the operand with the
 *   smallest/largest finite contribution. Non-finite operand values at that
 *   index are ignored; if no operand is finite the observation is skipped.
 *   Ties split the win equally across the tied operands (fractional wins), so
 *   the shares always sum to 1 across counted observations.
 * - The usable sample length is the minimum operand series length (guards
 *   against ragged recordings), mirroring `computeInputActiveFraction`.
 * - When any operand lacks a usable contribution series, or no observation
 *   could be evaluated, or the kind is `IF`, an even `1/n` split is returned
 *   with `fallback: true`.
 *
 * @param {{ squash: unknown, operands: SelectionOperand[] }} input
 * @returns {SelectionWinResult}
 */
export function computeSelectionWinShares(input) {
  const kind = normaliseSelectionSquash(input?.squash);
  const operands = Array.isArray(input?.operands) ? input.operands : [];
  const n = operands.length;

  if (!kind || n === 0) {
    return { kind, shares: [], fallback: false, sampleCount: 0 };
  }

  const evenSplit = () => ({
    kind,
    shares: operands.map(() => 1 / n),
    fallback: true,
    sampleCount: 0,
  });

  // IF operand roles are not identifiable from a plain snapshot — even split.
  if (kind === "IF") return evenSplit();

  const series = operands.map((o) =>
    Array.isArray(o?.contributions) ? o.contributions : null
  );
  if (series.some((s) => s === null)) return evenSplit();

  // Denominator bounded by the shortest series so we never index past the end.
  let len = Infinity;
  for (const s of series) {
    if (s.length < len) len = s.length;
  }
  if (!Number.isFinite(len) || len === 0) return evenSplit();

  const wantMin = kind === "MINIMUM";
  const wins = new Array(n).fill(0);
  let counted = 0;

  for (let i = 0; i < len; i++) {
    let best = wantMin ? Infinity : -Infinity;
    /** @type {number[]} */
    let winners = [];
    for (let j = 0; j < n; j++) {
      const v = series[j][i];
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      if (v === best) {
        winners.push(j);
      } else if (wantMin ? v < best : v > best) {
        best = v;
        winners = [j];
      }
    }
    if (winners.length === 0) continue; // no finite operand this observation
    const credit = 1 / winners.length; // split ties equally
    for (const j of winners) wins[j] += credit;
    counted += 1;
  }

  if (counted === 0) return evenSplit();

  return {
    kind,
    shares: wins.map((w) => w / counted),
    fallback: false,
    sampleCount: counted,
  };
}
