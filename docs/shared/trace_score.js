/**
 * Trace Explorer breadcrumb score helpers (Issue #184).
 *
 * The Trace Explorer breadcrumb shows the path the user has taken from an
 * output neuron upstream toward observations. Issue #184 asked us to surface
 * the current step's inbound-allocation "score" next to the `Path:` label so
 * phone users do not have to open the path-summary modal to see it. This
 * module hosts the pure (DOM-free) formatter so it can be unit-tested.
 *
 * The score is the current neuron's impact (a fraction in [0, 1] of its
 * influence on the network outputs), formatted as a compact percentage.
 */

import { formatDecimal } from "./number_format.js";

/**
 * Format a neuron impact as a compact percentage suitable for the breadcrumb
 * "Score:" badge.
 *
 * @param {unknown} impact — raw impact value (fraction of output influence).
 * @returns {string} a short label, or "—" when the impact is missing/invalid.
 */
export function formatTraceScore(impact) {
  if (impact == null) return "—";
  const n = typeof impact === "number" ? impact : Number(impact);
  if (!Number.isFinite(n)) return "—";

  const pct = n * 100;
  const abs = Math.abs(pct);
  if (abs >= 10) return `${formatDecimal(pct, 1)}%`;
  if (abs >= 1) return `${formatDecimal(pct, 2)}%`;
  if (abs === 0) return "0%";
  return `${pct.toPrecision(2)}%`;
}
