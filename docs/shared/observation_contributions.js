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

/** Default top-N highlight count (Issue #243). */
export const DEFAULT_TOP_N = 10;

/** Maximum allowed top-N highlight count (Issue #243). */
export const MAX_TOP_N = 100;

/**
 * Clamp a top-N stepper value into the supported range.
 *
 * Pure helper shared between the panel render path and the stepper UI in
 * docs/app.js so both agree on the same rounding/clamping rules:
 *   - non-finite / non-numeric inputs fall back to {@link DEFAULT_TOP_N};
 *   - decimals are floored;
 *   - values below 1 clamp to 1; values above {@link MAX_TOP_N} clamp to
 *     MAX_TOP_N.
 *
 * @param {unknown} value
 * @returns {number} integer in [1, MAX_TOP_N]
 */
export function clampTopN(value) {
  // Numeric strings (input.value) are coerced; everything else that can't
  // become a finite number falls back to the default.
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return DEFAULT_TOP_N;
  const floored = Math.floor(n);
  if (floored < 1) return 1;
  if (floored > MAX_TOP_N) return MAX_TOP_N;
  return floored;
}

/**
 * @typedef {object} ObservationContribution
 * @property {string} uuid — observation neuron UUID (typically `input-N`).
 * @property {number} score — normalised share in [0, 1]. After Issue #273
 *   this is the *effective* (post-gate) share when the calc layer was
 *   supplied with a consumer contract.
 * @property {number} [effectiveShare] — explicit post-gate share. When
 *   supplied, takes precedence over `score` for the primary display.
 * @property {number} [gateMaskedFraction] — fraction of samples in which
 *   downstream `min(...)` gating masked this input out (0..1). When > 0
 *   the renderer surfaces a "pre-gate" badge so users can see that gating
 *   has reduced the input's effective contribution.
 * @property {number} [preGateShare] — un-gated share for the same input.
 *   Optional; when absent the renderer reconstructs an indicative pre-gate
 *   value from `score / (1 - gateMaskedFraction)` so the badge still
 *   displays a useful number.
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
  const { getAlias, getGroup, isTopInfluencer = false } = lookups;
  const uuid = String(row?.uuid ?? "");
  const alias = typeof getAlias === "function" ? getAlias(uuid) : null;
  const group = typeof getGroup === "function" ? getGroup(uuid) : null;
  const label = alias ? `${alias} (${uuid})` : uuid;
  // Issue #273 — when the calc layer supplied gate-aware values we prefer
  // `effectiveShare` for the primary number. Fall back to `score` (which
  // is what the multi-hop walk already collapses gating into) so callers
  // that don't yet pass `effectiveShare` keep their current display.
  const primary = typeof row?.effectiveShare === "number"
    ? row.effectiveShare
    : Number(row?.score) || 0;
  const pct = formatSharePercent(primary);

  const subtitle = group
    ? `<div class="observationContributionsGroup">${escapeHtml(group)}</div>`
    : "";

  // Top-N visual emphasis hook (Issue #243). Both the class and the
  // data-attribute are emitted so CSS rules and any future JS hooks can pick
  // whichever is more convenient.
  const topClass = isTopInfluencer ? " top-influencer" : "";
  const topAttr = isTopInfluencer ? ` data-top-influencer="true"` : "";

  // Pre-gate badge (Issue #273): only render when downstream gating
  // actually masks samples for this input.
  const gateMaskedFraction = Number(row?.gateMaskedFraction) || 0;
  let preGateBadge = "";
  if (gateMaskedFraction > 0) {
    const preGate = typeof row?.preGateShare === "number"
      ? row.preGateShare
      : (gateMaskedFraction < 1 ? primary / (1 - gateMaskedFraction) : primary);
    const maskedPct = formatSharePercent(gateMaskedFraction, 3);
    const tooltip =
      `Pre-gate share — masked by downstream min(...) gate in ${maskedPct} of samples`;
    preGateBadge =
      `<span class="stat preGateBadge" data-pre-gate="true" title="${
        escapeHtml(tooltip)
      }">pre-gate: ${escapeHtml(formatSharePercent(preGate))}</span>`;
  }

  return `
      <div class="impactBreakdownRow observationContributionsRow${topClass}" data-uuid="${
    escapeHtml(uuid)
  }"${topAttr}>
        <div class="observationContributionsLabelWrap">
          <div class="impactBreakdownOut">${escapeHtml(label)}</div>
          ${subtitle}
        </div>
        <div class="impactBreakdownStats">
          <span class="stat" title="Effective share after downstream gating (normalised across shown inputs)">${
    escapeHtml(pct)
  }</span>
          ${preGateBadge}
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
 * @param {ObservationContribution[]} params.inputs — observations to render.
 *   The panel sorts defensively by `|score|` descending so callers may pass
 *   pre-sorted or unsorted input (Issue #243).
 * @param {(uuid: string) => (string | null)} [params.getAlias]
 * @param {(uuid: string) => (string | null)} [params.getGroup]
 * @param {number} [params.max=MAX_OBSERVATION_ROWS] — hard safety ceiling on
 *   the number of rendered rows. The effective render count is
 *   `min(clampedTopN, max, inputs.length)`.
 * @param {number} [params.topN=DEFAULT_TOP_N] — caps the number of rendered
 *   rows and marks each rendered row with the `top-influencer` class for
 *   visual emphasis (Issue #275 / #243). Clamped to `[1, MAX_TOP_N]`;
 *   invalid values fall back to `DEFAULT_TOP_N`. When fewer than `topN`
 *   inputs exist, all of them render.
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
    topN,
    isPhone = false,
    userToggle = null,
  } = params ?? {};

  if (!shouldRenderObservationContributions(uuid, neuronType)) return "";

  const safeInputs = Array.isArray(inputs) ? inputs : [];
  // Defensive sort by |score| descending (#243). Caller may pass pre-sorted
  // inputs; sorting again is O(n log n) on a small list and keeps the panel
  // self-contained.
  const sorted = safeInputs.slice().sort((a, b) => {
    const aAbs = Math.abs(Number(a?.score) || 0);
    const bAbs = Math.abs(Number(b?.score) || 0);
    return bAbs - aAbs;
  });

  const clampedTopN = clampTopN(topN);
  // Cap rendered rows by topN (Issue #275). MAX_OBSERVATION_ROWS remains a
  // hard safety ceiling so callers can't force unbounded rendering.
  const renderLimit = Math.min(clampedTopN, max);
  const top = sorted.slice(0, renderLimit);
  if (top.length === 0) return "";

  const title = "Observation contributions";
  const note =
    "Top input observations ranked by their multi-hop share of this output. " +
    "Each row shows the observation's group as a subtitle when available. " +
    "When a downstream min(...) gate masks an input in some samples, a " +
    "'pre-gate' badge shows what the share would have been without the gate.";

  // Summary shows enough context when collapsed: title + (count) so a phone
  // user can scan without expanding (#187). The number reflects how many rows
  // are visually emphasised — capped by the number of rendered rows so the
  // label never overstates what the user can see (#243).
  const summaryCount = Math.min(clampedTopN, top.length);
  const summaryLabel = `${title} (top ${summaryCount})`;
  const open = isObservationContributionsOpen({ isPhone, userToggle });
  const openAttr = open ? " open" : "";

  const rows = top
    .map((row, idx) =>
      buildObservationContributionsRow(row, {
        getAlias,
        getGroup,
        isTopInfluencer: idx < clampedTopN,
      })
    )
    .join("");

  // Stepper input (Issue #243). The handler in docs/app.js debounces the
  // change, clamps via clampTopN, persists to localStorage and re-renders.
  // Click/keydown propagation is stopped from the wiring side so interacting
  // with the input doesn't toggle the surrounding <details>.
  const stepperHtml =
    `<input type="number" class="observationContributionsTopNInput"` +
    ` min="1" max="${MAX_TOP_N}" step="1" value="${clampedTopN}"` +
    ` aria-label="Number of top influencers to highlight"` +
    ` data-role="observation-topn-stepper" />`;

  return `
    <details class="observationContributionsDetails" data-uuid="${
    escapeHtml(uuid)
  }"${openAttr}>
      <summary class="impactBreakdownHeader observationContributionsSummary">
        <span class="impactBreakdownTitle">${escapeHtml(summaryLabel)}</span>
        ${stepperHtml}
      </summary>
      <div class="impactBreakdownNote">${escapeHtml(note)}</div>
      <div class="impactBreakdownList observationContributionsList">${rows}</div>
    </details>
  `;
}
