/**
 * Recording diagnostics scan — pure computation, no DOM dependencies.
 *
 * Scans recording data for non-finite values (NaN/Infinity) and error
 * concentration patterns. Used by the issues tab to surface data quality
 * warnings.
 */

import { summariseErrorConcentration } from "../impact_diagnostics.js";

/**
 * Scan a 1D numeric array for non-finite values.
 *
 * @param {unknown[]} arr - Array to scan.
 * @returns {{ count: number, firstPos: number|null }} Count of non-finite
 *   values and position of the first one found.
 */
export function scan1d(arr) {
  if (!Array.isArray(arr)) return { count: 0, firstPos: null };
  let count = 0;
  let firstPos = null;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (typeof v === "number" && isFinite(v)) continue;
    count += 1;
    if (firstPos == null) firstPos = i;
  }
  return { count, firstPos };
}

/**
 * Scan a 2D numeric array for non-finite values.
 *
 * @param {unknown[][]} arr - 2D array to scan (rows of values).
 * @returns {{ count: number, firstPos: number|null }} Count of non-finite
 *   values and row index of the first one found.
 */
export function scan2d(arr) {
  if (!Array.isArray(arr)) return { count: 0, firstPos: null };
  let count = 0;
  let firstPos = null;
  for (let i = 0; i < arr.length; i++) {
    const row = arr[i];
    if (!Array.isArray(row)) continue;
    for (let j = 0; j < row.length; j++) {
      const v = row[j];
      if (typeof v === "number" && isFinite(v)) continue;
      count += 1;
      if (firstPos == null) firstPos = i;
    }
  }
  return { count, firstPos };
}

/**
 * Scan recording data for NaN/Infinity values across all neuron series.
 *
 * @param {object} opts
 * @param {object|null} opts.recording - Recording data with `neurons` map and
 *   optional `obsIndices` / `obs_indices`.
 * @returns {Map<string, { total: number, activation: { count: number, firstObsIndex: number|null }, value: { count: number, firstObsIndex: number|null }, errors: { count: number, firstObsIndex: number|null } }>} Map from neuron UUID to issue summary.
 */
export function computeNonFiniteIssues({ recording }) {
  const obsIndices = recording?.obsIndices ?? recording?.obs_indices ?? null;
  const neurons = recording?.neurons ?? {};
  const out = new Map();

  function obsAt(pos) {
    if (Array.isArray(obsIndices) && pos >= 0 && pos < obsIndices.length) {
      return obsIndices[pos];
    }
    return pos;
  }

  for (const [uuid, rec] of Object.entries(neurons)) {
    if (!rec || typeof rec !== "object") continue;
    const act = scan1d(rec.activation);
    const val = scan1d(rec.value);
    const err = scan2d(rec.errors);
    const total = act.count + val.count + err.count;
    if (total <= 0) continue;

    out.set(uuid, {
      total,
      activation: {
        count: act.count,
        firstObsIndex: act.firstPos == null ? null : obsAt(act.firstPos),
      },
      value: {
        count: val.count,
        firstObsIndex: val.firstPos == null ? null : obsAt(val.firstPos),
      },
      errors: {
        count: err.count,
        firstObsIndex: err.firstPos == null ? null : obsAt(err.firstPos),
      },
    });
  }

  return out;
}

/**
 * Scan recording data for error concentration patterns.
 *
 * Identifies neurons where error energy is concentrated in a small number
 * of observation indices, suggesting overfitting or outlier sensitivity.
 *
 * @param {object} opts
 * @param {object|null} opts.recording - Recording data with `neurons` map and
 *   optional `obsIndices` / `obs_indices`.
 * @returns {Map<string, { total: number, topK: { obsIndex: number, value: number, shareOfTotal: number }[], topKShare: number }>} Map from neuron UUID to concentration summary.
 */
export function computeErrorConcentrationIssues({ recording }) {
  const obsIndices = recording?.obsIndices ?? recording?.obs_indices ?? null;
  const neurons = recording?.neurons ?? {};
  const out = new Map();

  function obsAt(pos) {
    if (Array.isArray(obsIndices) && pos >= 0 && pos < obsIndices.length) {
      return obsIndices[pos];
    }
    return pos;
  }

  for (const [uuid, rec] of Object.entries(neurons)) {
    if (!rec || typeof rec !== "object") continue;
    const errors = rec.errors;
    if (!Array.isArray(errors) || errors.length === 0) continue;

    /** @type {number[]} */
    const contrib = [];
    for (let i = 0; i < errors.length; i++) {
      const row = errors[i];
      if (!Array.isArray(row) || row.length === 0) {
        contrib.push(0);
        continue;
      }
      let sum = 0;
      let n = 0;
      for (const e of row) {
        if (typeof e !== "number" || !isFinite(e)) continue;
        sum += e * e;
        n += 1;
      }
      contrib.push(n > 0 ? sum / n : 0);
    }

    const s = summariseErrorConcentration(contrib, { topK: 8 });
    if (s.total <= 0) continue;

    out.set(uuid, {
      total: s.total,
      topK: s.topK.map((t) => ({
        obsIndex: obsAt(t.index),
        value: t.value,
        shareOfTotal: t.shareOfTotal,
      })),
      topKShare: s.topKShare,
    });
  }

  return out;
}
