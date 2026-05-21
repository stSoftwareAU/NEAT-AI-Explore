/**
 * Observation contributions panel (Issue #186).
 *
 * Pure, DOM-free helpers for the "Observation contributions" panel shown on
 * the output neuron card in the Trace Explorer. The panel ranks the top
 * input observations by their multi-hop share of the output and shows each
 * observation's tooltip group as a small subtitle.
 *
 * This module is intentionally DOM-free so it can be unit-tested under
 * Deno. The browser bootstrap (docs/app.js) is responsible for plugging it
 * into the DOM and for sourcing the inputs from
 * `computeTopContributingInputs`.
 */

import { escapeHtml } from "./ui_helpers.js";

/** Maximum number of rows the panel renders inline. */
export const MAX_OBSERVATION_ROWS = 50;

/**
 * @typedef {object} ObservationContribution
 * @property {string} uuid — observation neuron UUID (typically `input-N`).
 * @property {number} score — normalised share in [0, 1].
 */

/**
 * Decide whether the panel should render for the given neuron.
 *
 * Per issue #186 the panel lives only on output neuron cards. Hidden and
 * input neurons never host the panel.
 *
 * @param {string} uuid
 * @param {string|null|undefined} neuronType
 * @returns {boolean}
 */
export function shouldRenderObservationContributions(uuid, neuronType) {
  if (typeof uuid !== "string" || uuid.length === 0) return false;
  if (neuronType !== "output") return false;
  // Defensive: callers occasionally pass output-only UUIDs without a type.
  // We still gate strictly on neuronType being "output".
  return true;
}

/**
 * Format a fractional share as a percent string with the given precision.
 *
 * Kept here (rather than importing the app.js `formatSig`) so the module
 * stays self-contained.
 *
 * @param {number} share — value in [0, 1].
 * @param {number} [sigFigs=4]
 * @returns {string}
 */
export function formatSharePercent(share, sigFigs = 4) {
  const n = Number(share) || 0;
  const pct = n * 100;
  if (!Number.isFinite(pct)) return "0%";
  // Use toPrecision then strip trailing zeros for a compact display.
  const s = pct.toPrecision(Math.max(1, sigFigs));
  // toPrecision can return exponential notation for very small/large values;
  // for the inline panel that's still acceptable.
  return `${s}%`;
}

/**
 * Build the HTML for a single observation row.
 *
 * Exposed for testing. Use {@link buildObservationContributionsHtml} for
 * the full panel.
 *
 * @param {ObservationContribution} row
 * @param {{ getAlias?: (uuid: string) => (string | null), getGroup?: (uuid: string) => (string | null) }} [lookups]
 * @returns {string}
 */
export function buildObservationContributionsRow(row, lookups = {}) {
  const { getAlias, getGroup } = lookups;
  const uuid = String(row?.uuid ?? "");
  const alias = typeof getAlias === "function" ? getAlias(uuid) : null;
  const group = typeof getGroup === "function" ? getGroup(uuid) : null;
  const label = alias ? `${alias} (${uuid})` : uuid;
  const pct = formatSharePercent(row?.score);

  const subtitle = group
    ? `<div class="observationContributionsGroup">${escapeHtml(group)}</div>`
    : "";

  return `
      <div class="impactBreakdownRow observationContributionsRow" data-uuid="${
    escapeHtml(uuid)
  }">
        <div class="observationContributionsLabelWrap">
          <div class="impactBreakdownOut">${escapeHtml(label)}</div>
          ${subtitle}
        </div>
        <div class="impactBreakdownStats">
          <span class="stat" title="Allocated share (normalised across shown inputs)">${
    escapeHtml(pct)
  }</span>
        </div>
      </div>
    `;
}

/**
 * Decide whether the panel's `<details>` should be open on first render.
 *
 * Defaults track the compact-layout decisions from #184: collapsed on phone
 * viewports (≤520px, matching `isNarrowMobile()` in docs/app.js), open
 * everywhere else. A user toggle from the current session wins over the
 * viewport default so re-renders don't snap the panel shut after the user
 * has expanded it.
 *
 * @param {{ isPhone?: boolean, userToggle?: ("open" | "closed" | null | undefined) }} [opts]
 * @returns {boolean} true when the `<details>` element should render with
 *   the `open` attribute.
 */
export function isObservationContributionsOpen(opts = {}) {
  const { isPhone = false, userToggle = null } = opts ?? {};
  if (userToggle === "open") return true;
  if (userToggle === "closed") return false;
  return !isPhone;
}

/**
 * Build the full HTML for the Observation contributions panel.
 *
 * Returns an empty string when the panel should not render (non-output
 * neuron, or no contributions). Callers (typically docs/app.js) set the
 * returned string as the panel container's innerHTML.
 *
 * The panel body is wrapped in a native `<details>` element with the
 * heading carried by `<summary>` so it remains keyboard accessible with no
 * extra JS. The default open/closed state follows the phone breakpoint
 * (collapsed on ≤520px, open otherwise — see #184), while an explicit
 * `userToggle` overrides that default for the current session.
 *
 * @param {object} params
 * @param {string} params.uuid — focused output neuron UUID.
 * @param {string|null|undefined} params.neuronType — focused neuron's `n.type`.
 * @param {ObservationContribution[]} params.inputs — already-sorted descending by share.
 * @param {(uuid: string) => (string | null)} [params.getAlias]
 * @param {(uuid: string) => (string | null)} [params.getGroup]
 * @param {number} [params.max=MAX_OBSERVATION_ROWS]
 * @param {boolean} [params.isPhone=false] — viewport matches the phone breakpoint.
 * @param {("open"|"closed"|null)} [params.userToggle=null] — session-scoped
 *   user override; wins over the viewport default.
 * @returns {string}
 */
export function buildObservationContributionsHtml(params) {
  const {
    uuid,
    neuronType,
    inputs,
    getAlias,
    getGroup,
    max = MAX_OBSERVATION_ROWS,
    isPhone = false,
    userToggle = null,
  } = params ?? {};

  if (!shouldRenderObservationContributions(uuid, neuronType)) return "";

  const safeInputs = Array.isArray(inputs) ? inputs : [];
  const top = safeInputs.slice(0, max);
  if (top.length === 0) return "";

  const title = "Observation contributions";
  const note =
    "Top input observations ranked by their multi-hop share of this output. " +
    "Each row shows the observation's group as a subtitle when available.";

  // Summary shows enough context when collapsed: title + (count) so a phone
  // user can scan without expanding (#187).
  const summaryLabel = `${title} (top ${top.length})`;
  const open = isObservationContributionsOpen({ isPhone, userToggle });
  const openAttr = open ? " open" : "";

  const rows = top
    .map((row) => buildObservationContributionsRow(row, { getAlias, getGroup }))
    .join("");

  return `
    <details class="observationContributionsDetails" data-uuid="${
    escapeHtml(uuid)
  }"${openAttr}>
      <summary class="impactBreakdownHeader observationContributionsSummary">
        <span class="impactBreakdownTitle">${escapeHtml(summaryLabel)}</span>
      </summary>
      <div class="impactBreakdownNote">${escapeHtml(note)}</div>
      <div class="impactBreakdownList observationContributionsList">${rows}</div>
    </details>
  `;
}
