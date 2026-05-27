/**
 * Gate indicator chip (Issue #273).
 *
 * Small DOM-free helper that builds the HTML for a "Gate" chip shown on a
 * neuron card when at least one inbound input is masked by a downstream
 * `min(...)` consumer gate (see Issue #272).
 *
 * The chip is rendered as an anchor pointing at the gate definition (the
 * consumer contract section in the snapshot, surfaced by docs/app.js).
 * When no gate URL is available the chip degrades to a `<span>` carrying
 * the same tooltip — the visual treatment is identical, the user just
 * cannot navigate further.
 *
 * Australian English note: prefer spellings like "behaviour", "colour".
 */

import { escapeHtml } from "./ui_helpers.js";

/**
 * Decide whether the gate chip should render for the given inbound rows.
 *
 * The chip renders when *any* row carries a `gateMaskedFraction > 0` — that
 * is, at least one input is sometimes masked out by a downstream gate.
 *
 * @param {Array<{ gateMaskedFraction?: number }> | null | undefined} rows
 * @returns {boolean}
 */
export function shouldRenderGateChip(rows) {
  if (!Array.isArray(rows)) return false;
  for (const r of rows) {
    const f = Number(r?.gateMaskedFraction);
    if (Number.isFinite(f) && f > 0) return true;
  }
  return false;
}

/**
 * Build the HTML for the gate chip.
 *
 * Returns an empty string when no inbound row reports gate-masking, so
 * callers can unconditionally interpolate the result.
 *
 * @param {{
 *   rows: Array<{ gateMaskedFraction?: number }> | null | undefined,
 *   gateUrl?: string | null,
 *   label?: string,
 * }} input
 * @returns {string}
 */
export function buildGateChipHtml(input) {
  const rows = input?.rows;
  if (!shouldRenderGateChip(rows)) return "";

  const label = typeof input?.label === "string" && input.label.length > 0
    ? input.label
    : "Gate";
  const gateUrl = typeof input?.gateUrl === "string" && input.gateUrl.length > 0
    ? input.gateUrl
    : null;

  // Surface the worst-case masking so the user has an at-a-glance number.
  let worst = 0;
  for (const r of rows) {
    const f = Number(r?.gateMaskedFraction);
    if (Number.isFinite(f) && f > worst) worst = f;
  }
  const worstPct = `${(worst * 100).toFixed(0)}%`;
  const title =
    `At least one inbound input is masked by a downstream min(...) gate ` +
    `(worst case: ${worstPct} of samples). Click to inspect the gate.`;

  const safeLabel = escapeHtml(label);
  const safeTitle = escapeHtml(title);
  if (gateUrl) {
    return `<a class="gateChip" href="${
      escapeHtml(gateUrl)
    }" title="${safeTitle}" data-role="gate-chip">${safeLabel}</a>`;
  }
  return `<span class="gateChip" title="${safeTitle}" data-role="gate-chip">${safeLabel}</span>`;
}
