/**
 * Synapse row rendering helpers (Issue #188).
 *
 * Pure, DOM-free helpers used by docs/app.js to build the "synapseFrom"
 * cell of an inbound-synapse row. All snapshot-derived strings (including
 * the source neuron's `type` field, which an attacker can poison via a
 * malicious snapshot URL) must be HTML-escaped before being interpolated
 * into the row's `innerHTML`.
 *
 * This module is intentionally DOM-free so it can be unit-tested under
 * Deno.
 */

import { escapeHtml } from "./ui_helpers.js";

/**
 * Build the HTML for the "synapseFrom" cell of an inbound-synapse row.
 *
 * `nameHtml` is assembled by the caller from already-escaped snapshot
 * strings (alias, UUID) and is treated as trusted markup. `fromType` is
 * a raw snapshot-derived value and is HTML-escaped here.
 *
 * @param {string} nameHtml — pre-escaped HTML fragment for the source name.
 * @param {unknown} fromType — source neuron's `type` field (snapshot-derived).
 * @returns {string} HTML string for the synapseFrom cell.
 */
export function buildSynapseFromCellHtml(nameHtml, fromType) {
  return `<div class="synapseFrom">
        ${nameHtml}
        <span class="neuronType">${escapeHtml(fromType)}</span>
      </div>`;
}
