/**
 * Recording diagnostics scan — pure computation, no DOM dependencies.
 *
 * Scans recording data for genuine non-finite values (NaN/Infinity), absent
 * (not-recorded) entries, and error concentration patterns. Used by the issues
 * tab to surface data quality facts.
 *
 * Absent vs non-finite (issue #507): a recording serialises through JSON, which
 * cannot carry NaN/Infinity — those become `null`. A `null` entry therefore
 * means "not recorded" (the error-attribution walk did not traverse this
 * neuron at that observation), NOT a genuine exploding gradient. We classify
 * the two separately so absent values are reported as a raw fact rather than
 * mis-flagged as non-finite.
 */

import { summariseErrorConcentration } from "../impact_diagnostics.js";

/**
 * Scan a 1D numeric array, classifying anomalies as absent (null/undefined) or
 * genuine non-finite (NaN/Infinity, or any non-number that is not null).
 *
 * @param {unknown[]} arr - Array to scan.
 * @returns {{ count: number, firstPos: number|null, absentCount: number,
 *   nonFiniteCount: number, firstAbsentPos: number|null,
 *   firstNonFinitePos: number|null }} `count`/`firstPos` cover all anomalies
 *   (absent + non-finite) for backward compatibility; the split fields report
 *   each category separately.
 */
export function scan1d(arr) {
  if (!Array.isArray(arr)) {
    return {
      count: 0,
      firstPos: null,
      absentCount: 0,
      nonFiniteCount: 0,
      firstAbsentPos: null,
      firstNonFinitePos: null,
    };
  }
  let count = 0;
  let firstPos = null;
  let absentCount = 0;
  let nonFiniteCount = 0;
  let firstAbsentPos = null;
  let firstNonFinitePos = null;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (typeof v === "number" && isFinite(v)) continue;
    count += 1;
    if (firstPos == null) firstPos = i;
    if (v == null) {
      // null or undefined → not recorded (error walk did not traverse).
      absentCount += 1;
      if (firstAbsentPos == null) firstAbsentPos = i;
    } else {
      // Genuine non-finite number (NaN/Infinity) or anomalous non-number.
      nonFiniteCount += 1;
      if (firstNonFinitePos == null) firstNonFinitePos = i;
    }
  }
  return {
    count,
    firstPos,
    absentCount,
    nonFiniteCount,
    firstAbsentPos,
    firstNonFinitePos,
  };
}

/**
 * Scan a 2D numeric array, classifying anomalies as absent (null/undefined) or
 * genuine non-finite (NaN/Infinity, or any non-number that is not null).
 *
 * @param {unknown[][]} arr - 2D array to scan (rows of values).
 * @returns {{ count: number, firstPos: number|null, absentCount: number,
 *   nonFiniteCount: number, firstAbsentPos: number|null,
 *   firstNonFinitePos: number|null }} Positions are row indices; `count`/
 *   `firstPos` cover all anomalies for backward compatibility.
 */
export function scan2d(arr) {
  if (!Array.isArray(arr)) {
    return {
      count: 0,
      firstPos: null,
      absentCount: 0,
      nonFiniteCount: 0,
      firstAbsentPos: null,
      firstNonFinitePos: null,
    };
  }
  let count = 0;
  let firstPos = null;
  let absentCount = 0;
  let nonFiniteCount = 0;
  let firstAbsentPos = null;
  let firstNonFinitePos = null;
  for (let i = 0; i < arr.length; i++) {
    const row = arr[i];
    if (!Array.isArray(row)) continue;
    for (let j = 0; j < row.length; j++) {
      const v = row[j];
      if (typeof v === "number" && isFinite(v)) continue;
      count += 1;
      if (firstPos == null) firstPos = i;
      if (v == null) {
        absentCount += 1;
        if (firstAbsentPos == null) firstAbsentPos = i;
      } else {
        nonFiniteCount += 1;
        if (firstNonFinitePos == null) firstNonFinitePos = i;
      }
    }
  }
  return {
    count,
    firstPos,
    absentCount,
    nonFiniteCount,
    firstAbsentPos,
    firstNonFinitePos,
  };
}

/**
 * Scan recording data for GENUINE non-finite values (NaN/Infinity) across all
 * neuron series.
 *
 * Absent (`null`) entries are NOT counted here — they mean "not recorded", not
 * a non-finite value (issue #507). Use {@link computeNotRecordedIssues} for
 * those. A recording serialises through JSON, so genuine non-finite values are
 * not expected; this scan remains so a real anomaly surfaces loudly rather than
 * being masked.
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
    const total = act.nonFiniteCount + val.nonFiniteCount + err.nonFiniteCount;
    if (total <= 0) continue;

    out.set(uuid, {
      total,
      activation: {
        count: act.nonFiniteCount,
        firstObsIndex: act.firstNonFinitePos == null
          ? null
          : obsAt(act.firstNonFinitePos),
      },
      value: {
        count: val.nonFiniteCount,
        firstObsIndex: val.firstNonFinitePos == null
          ? null
          : obsAt(val.firstNonFinitePos),
      },
      errors: {
        count: err.nonFiniteCount,
        firstObsIndex: err.firstNonFinitePos == null
          ? null
          : obsAt(err.firstNonFinitePos),
      },
    });
  }

  return out;
}

/**
 * Scan recording data for absent (not-recorded) entries across all neuron
 * series.
 *
 * A `null` entry means the value was not recorded for that observation (the
 * error-attribution walk did not traverse this neuron) — a raw recording fact,
 * not a non-finite/exploding-gradient problem (issue #507). Each series reports
 * how many of its slots are absent (`count`) out of the recorded total
 * (`length` / `rows`), so the viewer can present "k/N not recorded" verbatim.
 *
 * @param {object} opts
 * @param {object|null} opts.recording - Recording data with `neurons` map and
 *   optional `obsIndices` / `obs_indices`.
 * @returns {Map<string, { total: number, activation: { count: number, length: number, firstObsIndex: number|null }, value: { count: number, length: number, firstObsIndex: number|null }, errors: { count: number, rows: number, firstObsIndex: number|null } }>} Map from neuron UUID to not-recorded summary.
 */
export function computeNotRecordedIssues({ recording }) {
  const obsIndices = recording?.obsIndices ?? recording?.obs_indices ?? null;
  const neurons = recording?.neurons ?? {};
  const out = new Map();

  function obsAt(pos) {
    if (Array.isArray(obsIndices) && pos >= 0 && pos < obsIndices.length) {
      return obsIndices[pos];
    }
    return pos;
  }

  function len(x) {
    return Array.isArray(x) ? x.length : 0;
  }

  for (const [uuid, rec] of Object.entries(neurons)) {
    if (!rec || typeof rec !== "object") continue;
    const act = scan1d(rec.activation);
    const val = scan1d(rec.value);
    const err = scan2d(rec.errors);
    const total = act.absentCount + val.absentCount + err.absentCount;
    if (total <= 0) continue;

    out.set(uuid, {
      total,
      activation: {
        count: act.absentCount,
        length: len(rec.activation),
        firstObsIndex: act.firstAbsentPos == null
          ? null
          : obsAt(act.firstAbsentPos),
      },
      value: {
        count: val.absentCount,
        length: len(rec.value),
        firstObsIndex: val.firstAbsentPos == null
          ? null
          : obsAt(val.firstAbsentPos),
      },
      errors: {
        count: err.absentCount,
        rows: len(rec.errors),
        firstObsIndex: err.firstAbsentPos == null
          ? null
          : obsAt(err.firstAbsentPos),
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
