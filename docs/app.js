/**
 * NEAT-AI Explore - Neuron Network Explorer
 *
 * Left-to-right exploration: current neuron on left, inbound synapses on right.
 * Click a synapse to navigate upstream toward inputs.
 *
 * Terminology (consistent with NEAT-AI):
 * - Neurons: hidden + output neurons (not inputs)
 * - Observations: input observations
 * - Synapses: connections between neurons
 */

import {
  computeImpactBreakdownToOutputs,
  computeInboundSynapseImpactAllocation,
} from "./impact_attribution.js";
import {
  buildGraphIndex,
  computeReachableToOutputs,
  computeTopContributingInputs as computeTopContributingInputsCore,
} from "./shared/graph_analysis.js";
import {
  computeGradientProxyImpact,
  computeOutgoingProxyTerms,
  computePreActivations,
  computeSquashDerivativeStats,
  summariseDeadZoneStats,
  summariseSeriesStats,
} from "./impact_diagnostics.js";
import {
  decodeBase64UrlToUtf8,
  gunzipToText,
  isDangerousUrlScheme,
  normaliseCreature as normaliseCreatureCore,
  normaliseSnapshotUrl,
  readSnapshotFile,
} from "./shared/snapshot_loader.js";
import {
  ALLOWED_SNAPSHOT_ORIGINS,
  AUTO_LOAD_MAX_RETRIES,
  AUTO_LOAD_RETRY_DELAY_MS,
  DEFAULT_SNAPSHOT_URL,
  SNAPSHOT_FALLBACK_URLS,
} from "./shared/config.js";
import {
  computeActivationDistribution,
  computeLayerTopology,
  computeNetworkDepth,
  computeNeuronBreakdown,
  computeSynapseStats,
} from "./shared/creature_overview.js";
import {
  PANEL_CROSSFADE_MS,
  prefersReducedMotion,
  synapseStaggerDelay,
} from "./shared/transitions.js";
import { synapseWeightColourCss } from "./shared/colour_maps.js";
import {
  topologyLegendHtml,
  topologyToSvgString,
} from "./shared/topology_diagram.js";
import { formatDecimal, formatInteger } from "./shared/number_format.js";
import {
  computeErrorHistogram,
  computeSparklinePoints,
  flattenErrors,
  squashBadge,
} from "./shared/sparkline.js";
import { computeTopInputCorrelations } from "./shared/correlation.js";
import { createDebounce } from "./shared/debounce.js";
import {
  extractDiscoveryCandidates,
  normaliseCandidate,
} from "./shared/discovery.js";
import {
  computeErrorConcentrationIssues,
  computeNonFiniteIssues,
  computeNotRecordedIssues,
} from "./shared/diagnostics_scan.js";
import { initThemeMode } from "./shared/theme.js";
import { formatTraceScore } from "./shared/trace_score.js";
import {
  hasOverflowActions,
  shouldCollapseTraceOverflow,
} from "./shared/trace_header.js";
import { wireTraceOverflowMenu } from "./shared/trace_overflow_menu.js";
import { createProgressUi } from "./shared/progress_ui.js";
import {
  buildObservationTooltip,
  escapeHtml,
  extractTooltips,
} from "./shared/ui_helpers.js";
import {
  loadFallbackTooltips,
  mergeTooltipMaps,
  needsFallbackTooltips,
} from "./shared/tooltips_fallback.js";
import {
  buildObservationContributionsHtml,
  clampTopN,
} from "./shared/observation_contributions.js";
import {
  loadObservationTopN,
  saveObservationTopN,
} from "./shared/observation_contributions_storage.js";
import { buildSynapseFromCellHtml } from "./shared/synapse_render.js";
import {
  computeInputActiveFraction,
  loadConsumerContract,
} from "./shared/consumer_contract.js";
import { buildGateChipHtml } from "./shared/gate_chip.js";
import {
  getInitialFocusTarget,
  installFocusTrap,
} from "./shared/modal_focus.js";
import { createTopoModalController } from "./shared/topo_modal.js";
import {
  decideFiltersMode,
  decideFiltersModeByWidth,
} from "./shared/filter_layout.js";
import {
  clearPanelSize,
  computeDragPanelSize,
  loadPanelSize,
  PANEL_SIZE_KEYS,
  resolveInitialPanelSize,
  savePanelSize,
} from "./shared/panel_resize.js";
/** @type {Element|null} Element that triggered the currently open modal. */
let _modalTrigger = null;
/** @type {(() => void)|null} Cleanup function for the current focus trap. */
let _focusTrapCleanup = null;

let SNAPSHOT = null;
/**
 * Consumer contract resolved from the loaded snapshot (Issue #272 / #273).
 * Threaded through every calc-layer call so inbound-synapse allocation and
 * the multi-hop influence walk credit gate-masked samples consistently.
 *
 * @type {(import("./shared/consumer_contract.js").ConsumerContract | null)}
 */
let CONSUMER_CONTRACT = null;
let synapses = [];
let neuronsByUuid = new Map();
let trace = []; // Array of neuron UUIDs
let uuidToLabel = {}; // "input-N" -> "human-name"
let uuidToDescription = {}; // "input-N" -> "Tooltip description"
let uuidToGroup = {}; // "input-N" -> "group label"

/** @type {Map<string, { fromUuid: string, toUuid: string, weight: number }[]>} */
let inboundByTo = new Map();

let DIAG_PRE = new Map();
let DIAG_SQUASH = new Map();
let DIAG_PROXY = new Map();
let DIAG_PRE_STATS = new Map();
let DIAG_DEADZONES = new Map();
let DIAG_NONFINITE = new Map();
let DIAG_NOTRECORDED = new Map();
let DIAG_ERROR_TAIL = new Map();
let DIAG_INPUTS = {
  constantInputs: [],
  correlatedPairs: [],
  candidateCoverage: [],
};

let DISCOVERY_CANDIDATES = [];
let selectedCandidateKey = null;
let currentNeuronTab = "details"; // details | issues | candidates

let lastInboundAllocation = null;
let lastInboundToUuid = null;
let lastInboundPage = 0;
const INBOUND_PAGE_SIZE = 200;

let INPUT_DASH = {
  inputCount: 0,
  rows: [], // { uuid, alias, description, reachable, outDegree, proxy, constant, candidates }
};

// Thresholds for highlighting
const IMPACT_HIGHLIGHT_THRESHOLD = 0.1; // Highlight if impact > 0.1
const IMPACT_SUSPICIOUS_THRESHOLD = 1e-8; // Suspiciously low - should be prunable
const MSE_ERROR_THRESHOLD = 0.3; // Highlight if MSE > 0.3
// Heuristic warning threshold for issue #26 (30-Dec-2025): STEP/BIPOLAR squashes
// with extreme pre-activation magnitudes can make value-domain error metrics
// (MSE/MAE) look 'obviously wrong' because saturation/outliers dominate.
const EXTREME_PREACTIVATION_ABS_MAX_FOR_STEP_BIPOLAR = 1e6;

// Maximum path items to show before truncating in the middle.
// When trace.length exceeds this, we show the first 2 items, an ellipsis, and
// the last 2 items. This keeps the origin (output) and current position visible.
const MAX_VISIBLE_PATH_ITEMS = 5;

// Tooltips for property labels
const TOOLTIPS = {
  "Type": "Neuron type: input, hidden, output, or constant",
  "Squash": "Activation function applied to the weighted sum of inputs",
  "Bias": "Constant value added before the activation function",
  "Pre-activation mean":
    "Pre-activation (net input) mean across samples. Pre-activation is the value before the squash: z = bias + Σ(weighted inputs).",
  "Pre-activation range":
    "Minimum and maximum pre-activation (net input) observed before the squash is applied.",
  "Pre-activation p99":
    "Approximate 99th percentile of pre-activation (net input). Large magnitudes often indicate saturation/clamping or numerical blow-ups upstream.",
  "Pre-activation |x| max":
    "Maximum absolute pre-activation (net input). Useful for spotting extreme values that can explode errors.",
  "Impact":
    "Fraction of influence this neuron has on the final output (0-1). Values < 1e-8 are suspiciously low and should be prunable.",
  "Impact (proxy, grad)":
    "Viewer-side diagnostic proxy (not the exported impact). Approximates influence to outputs using |weight| and an estimated squash derivative. Useful for spotting problematic non-smooth squashes.",
  "Squash |d| mean":
    "Mean absolute derivative of this neuron's squash across recorded samples. Near 0 means the squash is mostly flat/saturated for these samples.",
  "Squash d≈0 %":
    "Percentage of recorded samples where the squash derivative magnitude is ~0 (|d| < 1e-6). High values suggest saturation/flat regions.",
  "Squash warning":
    "Explains when the squash is non-smooth, piecewise, or otherwise hard to differentiate. This can invalidate gradient-style impact calculations.",
  "Mean Activation": "Average output value across all samples",
  "Activation Range": "Minimum and maximum activation values observed",
  "MAE": "Mean Absolute Error - used in focus neuron ranking",
  "MSE": "Mean Squared Error - matches production creature scoring",
  "MSE/MAE warning":
    "For STEP/BIPOLAR squashes with extreme pre-activation magnitudes, value-domain error metrics (MSE/MAE) can be dominated by saturation/outliers. Check the Issues tab for supporting evidence (e.g. error tails).",
  "Samples": "Number of observations recorded for this neuron",
  "Max Recon Δ":
    "Maximum reconstruction delta - largest difference between recorded activation and recomputed activation from inputs. High values suggest recording or squash function issues.",
};

function isStepOrBipolarSquash(squash) {
  const s = (squash ?? "").toString().toUpperCase();
  return s === "STEP" || s === "BIPOLAR";
}

function squashWarningExplanation(note, squash) {
  const n = (note ?? "").toString();
  const s = (squash ?? "").toString();

  if (n === "piecewise") {
    return `Piecewise means the squash is defined by different formulas in different ranges (e.g. HARD_TANH clamps outside [-1, 1]). The derivative changes abruptly at boundaries. (squash: ${s})`;
  }
  if (n === "clamped") {
    return `Clamped means the squash has hit a hard limit, so the local derivative is ~0 beyond the clamp. (squash: ${s})`;
  }
  if (n === "kink at 0") {
    return `Kink at 0 means the derivative is discontinuous at 0 (e.g. RELU/ABS). Small input changes near 0 can flip behaviour. (squash: ${s})`;
  }
  if (n === "singular near 0") {
    return `Singular near 0 means the derivative can blow up near 0 (e.g. SQRT). This can make impact estimates unstable. (squash: ${s})`;
  }
  if (n === "singular near asymptote") {
    return `Singular near asymptote means the derivative can blow up near an asymptote (e.g. TAN near π/2 + kπ). This can make impact estimates unstable. (squash: ${s})`;
  }
  if (n === "undefined for x≤0") {
    return `Undefined for x≤0 means the squash isn't differentiable/defined in that region (e.g. SQRT(max(0,x))). (squash: ${s})`;
  }
  if (n === "non-smooth/branching") {
    return `Non-smooth/branching squashes (e.g. IF/MIN/MAX/STEP) can change behaviour discontinuously. Derivative-based impact calculations can be misleading. (squash: ${s})`;
  }
  if (n === "unsupported activation model") {
    return `Unsupported activation model: this activation isn't a simple scalar squash of a pre-activation (e.g. HYPOT/MEAN style). The viewer can't model its derivative reliably. Treat derivative-based diagnostics with caution. (squash: ${s})`;
  }
  if (n === "unknown squash") {
    return `Unknown squash: the viewer doesn't know the derivative model. Treat any derivative-based diagnostics with caution. (squash: ${s})`;
  }
  if (n) return `${n} (squash: ${s})`;
  return `Non-smooth squash behaviour detected. (squash: ${s})`;
}

const el = {
  fetchUrl: document.getElementById("fetchUrl"),
  fetchBtn: document.getElementById("fetchBtn"),
  fileInput: document.getElementById("fileInput"),
  fileBtn: document.getElementById("fileBtn"),
  progressContainer: document.getElementById("progressContainer"),
  progressBar: document.getElementById("progressBar"),
  status: document.getElementById("status"),
  traceBreadcrumb: document.getElementById("traceBreadcrumb"),
  traceScore: document.getElementById("traceScore"),
  traceBackBtn: document.getElementById("traceBackBtn"),
  traceClearBtn: document.getElementById("traceClearBtn"),
  graphBtn: document.getElementById("graphBtn"),
  currentNeuronTitle: document.getElementById("currentNeuronTitle"),
  neuronProps: document.getElementById("neuronProps"),
  impactBreakdown: document.getElementById("impactBreakdown"),
  impactDiagnosticsPanel: document.getElementById("impactDiagnosticsPanel"),
  synapsePanelToggle: document.getElementById("synapsePanelToggle"),
  neuronTabDetails: document.getElementById("neuronTabDetails"),
  neuronTabIssues: document.getElementById("neuronTabIssues"),
  neuronTabCandidates: document.getElementById("neuronTabCandidates"),
  neuronTabPanelDetails: document.getElementById("neuronTabPanelDetails"),
  neuronTabPanelIssues: document.getElementById("neuronTabPanelIssues"),
  neuronTabPanelCandidates: document.getElementById("neuronTabPanelCandidates"),
  pathModal: document.getElementById("pathModal"),
  pathModalBackdrop: document.getElementById("pathModalBackdrop"),
  pathModalTitle: document.getElementById("pathModalTitle"),
  pathModalBody: document.getElementById("pathModalBody"),
  pathModalClose: document.getElementById("pathModalClose"),
  pathModalMore: document.getElementById("pathModalMore"),
  observationContributionsPanel: document.getElementById(
    "observationContributionsPanel",
  ),
  obsBtn: document.getElementById("obsBtn"),
  obsModal: document.getElementById("obsModal"),
  obsModalBackdrop: document.getElementById("obsModalBackdrop"),
  obsModalTitle: document.getElementById("obsModalTitle"),
  obsModalBody: document.getElementById("obsModalBody"),
  obsModalClose: document.getElementById("obsModalClose"),
  synapseCount: document.getElementById("synapseCount"),
  synapseSort: document.getElementById("synapseSort"),
  synapseMinAlloc: document.getElementById("synapseMinAlloc"),
  synapseTopK: document.getElementById("synapseTopK"),
  synapseListContainer: document.getElementById("synapseListContainer"),
  // Issue #245 — inline filters / collapsed popover.
  synapseHeader: document.querySelector(".synapseHeader"),
  synapseTools: document.querySelector(".synapseList .synapseTools"),
  synapseFiltersToggle: document.getElementById("synapseFiltersToggle"),
  synapseFilterPanel: document.getElementById("synapseFilterPanel"),
  overviewDashboard: document.getElementById("overviewDashboard"),
  overviewMetrics: document.getElementById("overviewMetrics"),
  overviewActivation: document.getElementById("overviewActivation"),
  overviewTopology: document.getElementById("overviewTopology"),
  overviewExploreBtn: document.getElementById("overviewExploreBtn"),
  // Issue #241 — topology pop-out modal.
  topoModal: document.getElementById("topoModal"),
  topoModalBackdrop: document.querySelector(".topoModalBackdrop"),
  topoModalClose: document.querySelector(".topoModalClose"),
  topoModalBody: document.getElementById("topoModalBody"),
  explorerMain: document.querySelector(".explorer"),
  // Issue #184 — compact phone trace nav. The overflow controls are queried
  // by class via wireTraceOverflowMenu()/syncTraceOverflowMode(); the former
  // id-based lookups (#383) always returned null and have been removed.
  themeToggle: document.getElementById("themeToggle"),
  appHeaderControls: document.querySelector(".headerControls"),
  traceButtons: document.querySelector(".traceButtons"),
  traceBar: document.querySelector(".traceBar"),
};

// ============================================================================
// Issue #184 — compact phone trace nav
// ============================================================================

/**
 * On phone viewports the theme `A` toggle moves down from the app header
 * into the trace nav row so the header doesn't waste a whole line. Listen
 * for viewport changes so the placement stays in sync as the user rotates
 * the device or resizes the window.
 */
function syncThemeTogglePlacement() {
  const toggle = el.themeToggle;
  const traceButtons = el.traceButtons;
  const headerControls = el.appHeaderControls;
  if (!toggle || !traceButtons || !headerControls) return;
  let isMobile = false;
  try {
    isMobile = window.matchMedia?.("(max-width: 639px)")?.matches === true;
  } catch (_e) {
    isMobile = false;
  }
  const inTraceBar = toggle.parentElement === traceButtons;
  if (isMobile && !inTraceBar) {
    traceButtons.appendChild(toggle);
  } else if (!isMobile && !headerControls.contains(toggle)) {
    headerControls.appendChild(toggle);
  }
}

function initCompactTraceNav() {
  initTraceOverflowMenu();
  syncThemeTogglePlacement();
  initTraceOverflowMeasurement();
  try {
    const mql = window.matchMedia?.("(max-width: 639px)");
    mql?.addEventListener?.("change", syncThemeTogglePlacement);
  } catch (_e) {
    // No-op — matchMedia unavailable.
  }
}

// ============================================================================
// Issue #246 — measurement-based trace overflow collapse
// ============================================================================

/**
 * Measure the trace bar's children against its content width and toggle
 * `data-overflow-mode` on `.traceOverflow` accordingly. Inline whenever
 * the children fit, collapsed only when they actually overflow.
 *
 * The previous behaviour hard-coded `(max-width: 639px)` which hid
 * Observations / 🧠 / Synapses on viewports that still had spare width.
 */
/**
 * Sum the natural width of a flex container's direct children, descending
 * into `display: contents` wrappers (which appear as flex items of their
 * parent). The breadcrumb is excluded because it claims `flex: 1` and
 * scrolls horizontally — counting its full content would never let the
 * row look like it fits.
 */
function sumTraceBarChildrenWidth(bar) {
  if (!(bar instanceof HTMLElement)) return 0;
  const win = typeof window !== "undefined" ? window : null;
  let total = 0;
  const visit = (node) => {
    for (const child of node.children) {
      if (!(child instanceof HTMLElement)) continue;
      // Skip the scrollable breadcrumb — its intrinsic width can exceed
      // the bar and it is allowed to scroll inside its flex track.
      if (child.classList.contains("breadcrumb")) {
        const r = child.getBoundingClientRect();
        total += r.width; // count its rendered (clamped) width only
        continue;
      }
      const style = win?.getComputedStyle?.(child);
      if (style && style.display === "contents") {
        visit(child);
        continue;
      }
      if (style && style.display === "none") continue;
      total += child.getBoundingClientRect().width;
    }
  };
  visit(bar);
  return total;
}

function syncTraceOverflowMode() {
  const bar = el.traceBar;
  const wrapper = document.querySelector(".traceOverflow");
  if (!(bar instanceof HTMLElement) || !(wrapper instanceof HTMLElement)) {
    return;
  }
  const currentMode = wrapper.getAttribute("data-overflow-mode") || "inline";
  // Measure the natural width the bar wants in inline mode. Force inline
  // first so collapsed-mode styles don't skew the measurement, then
  // restore at the end before any paint.
  if (currentMode !== "inline") {
    wrapper.setAttribute("data-overflow-mode", "inline");
  }
  const cs = (typeof window !== "undefined" && window.getComputedStyle)
    ? window.getComputedStyle(bar)
    : null;
  const padLeft = cs ? parseFloat(cs.paddingLeft) || 0 : 0;
  const padRight = cs ? parseFloat(cs.paddingRight) || 0 : 0;
  const gap = cs ? parseFloat(cs.columnGap || cs.gap) || 0 : 0;
  const barWidth = bar.clientWidth;
  const childrenWidth = sumTraceBarChildrenWidth(bar);
  // Account for inter-item gaps — every direct flex item adds one gap
  // except the last. Count only top-level rendered items.
  const itemCount = countTopLevelFlexItems(bar);
  const gapTotal = Math.max(0, itemCount - 1) * gap;
  const collapse = shouldCollapseTraceOverflow({
    barWidth,
    childrenWidth: childrenWidth + gapTotal,
    padding: padLeft + padRight,
  });
  // Issue #384 — only collapse behind "⋯" when the menu actually has a
  // visible action to reveal. With no visible actions, force inline so the
  // summary stays hidden and no inert "⋯" button is left behind.
  const visibleActionCount = countVisibleOverflowActions(wrapper);
  const nextMode = collapse && hasOverflowActions({ visibleActionCount })
    ? "collapsed"
    : "inline";
  if (nextMode !== currentMode) {
    wrapper.setAttribute("data-overflow-mode", nextMode);
    // Closing the popover keeps focus/aria in a sane state when the
    // controls swap back into the inline row.
    if (nextMode === "inline") {
      wrapper.setAttribute("data-overflow-open", "false");
      const summary = wrapper.querySelector(".traceOverflowSummary");
      if (summary instanceof HTMLElement) {
        summary.setAttribute("aria-expanded", "false");
      }
    }
  } else if (currentMode !== "inline") {
    // Restore the previous mode the measurement pass clobbered.
    wrapper.setAttribute("data-overflow-mode", currentMode);
  }
}

// Issue #384 — count the overflow menu's visible actions, skipping any
// `display:none` items (mirrors the visibility pattern in
// sumTraceBarChildrenWidth/countTopLevelFlexItems). Drives whether the "⋯"
// summary should render at all.
function countVisibleOverflowActions(wrapper) {
  if (!(wrapper instanceof HTMLElement)) return 0;
  const win = typeof window !== "undefined" ? window : null;
  const items = wrapper.querySelectorAll(
    ".traceOverflowMenu [role='menuitem']",
  );
  let count = 0;
  for (const item of items) {
    if (!(item instanceof HTMLElement)) continue;
    const style = win?.getComputedStyle?.(item);
    if (style && style.display === "none") continue;
    count += 1;
  }
  return count;
}

function countTopLevelFlexItems(bar) {
  if (!(bar instanceof HTMLElement)) return 0;
  const win = typeof window !== "undefined" ? window : null;
  let count = 0;
  const visit = (node) => {
    for (const child of node.children) {
      if (!(child instanceof HTMLElement)) continue;
      const style = win?.getComputedStyle?.(child);
      if (style && style.display === "contents") {
        visit(child);
        continue;
      }
      if (style && style.display === "none") continue;
      count += 1;
    }
  };
  visit(bar);
  return count;
}

function initTraceOverflowMeasurement() {
  const bar = el.traceBar;
  const wrapper = document.querySelector(".traceOverflow");
  if (!(bar instanceof HTMLElement) || !(wrapper instanceof HTMLElement)) {
    return;
  }
  // Ensure the attribute exists from first paint so CSS has a target.
  if (!wrapper.hasAttribute("data-overflow-mode")) {
    wrapper.setAttribute("data-overflow-mode", "inline");
  }
  // Debounce to avoid layout thrash when many resize events fire in quick
  // succession (e.g. window drag, font swap, side-panel collapse).
  const debounced = createDebounce(syncTraceOverflowMode, 60);
  // Initial pass after first layout settles.
  syncTraceOverflowMode();
  if (typeof ResizeObserver === "function") {
    try {
      const ro = new ResizeObserver(() => debounced.call());
      ro.observe(bar);
    } catch (_e) {
      // Fall through to the window resize fallback below.
    }
  }
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("resize", () => debounced.call());
  }
}

// ============================================================================
// Inbound list filters (to keep large creatures usable)
// ============================================================================

function isNarrowMobile() {
  try {
    return window.matchMedia?.("(max-width: 520px)")?.matches === true;
  } catch (_e) {
    return false;
  }
}

function defaultInboundTopK() {
  // iPhone: tighter default to keep the list scannable.
  return isNarrowMobile() ? 80 : 200;
}

let inboundMinAllocImpact = 0;
let inboundTopK = defaultInboundTopK(); // 0 means unlimited
let inboundRenderLimit = inboundTopK || 0;

function parseMaybeNumber(s) {
  const raw = String(s ?? "").trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!isFinite(n)) return null;
  return n;
}

function syncInboundFilterControls() {
  if (el.synapseMinAlloc) {
    el.synapseMinAlloc.value = inboundMinAllocImpact > 0
      ? String(inboundMinAllocImpact)
      : "";
  }
  if (el.synapseTopK) {
    // If the exact value isn't present in the select, fall back to the closest
    // supported option. This avoids the select appearing blank on iPhone when
    // defaults use a value like 80.
    const select = el.synapseTopK;
    const desired = inboundTopK === 0 ? 0 : inboundTopK;
    const opts = Array.from(select.options ?? [])
      .map((o) => parseMaybeNumber(o.value))
      .filter((n) => typeof n === "number" && isFinite(n));

    if (opts.length === 0) {
      select.value = inboundTopK === 0 ? "0" : String(inboundTopK);
    } else {
      // Choose the closest numeric option (prefer exact match).
      let best = opts[0];
      let bestDist = Math.abs(best - desired);
      for (const v of opts) {
        const d = Math.abs(v - desired);
        if (d < bestDist) {
          best = v;
          bestDist = d;
        }
      }
      select.value = String(best);

      // Keep state consistent with what the UI can represent.
      inboundTopK = best;
    }
  }
}

function resetInboundRenderLimit() {
  inboundRenderLimit = inboundTopK || 0;
}

// ============================================================================
// Input labels and descriptions (from snapshot.tooltips)
// ============================================================================

function loadInputLabelsFromSnapshot(snapshot) {
  const result = extractTooltips(snapshot);
  uuidToLabel = result.labels;
  uuidToDescription = result.descriptions;
  uuidToGroup = result.groups;
}

/**
 * Issue #521 — snapshots generated before GRQ embedded Tooltips.json carry no
 * descriptions. For those, merge in the bundled copy so observation rows still
 * have a summary to show on hover. The snapshot always wins where it has data.
 */
async function applyFallbackTooltips() {
  if (!needsFallbackTooltips({ descriptions: uuidToDescription })) return;
  try {
    const fallback = await loadFallbackTooltips();
    uuidToDescription = mergeTooltipMaps(
      uuidToDescription,
      fallback.descriptions,
    );
  } catch (e) {
    // The bundle is committed to this repo, so a failure here is a real
    // deploy/serving fault — surface it loudly rather than silently showing
    // label-only tooltips.
    console.error("Bundled observation tooltips unavailable:", e);
  }
}

function getAlias(uuid) {
  return uuidToLabel[uuid] ?? null;
}

function getInputDescription(uuid) {
  return uuidToDescription[uuid] ?? null;
}

function getInputGroup(uuid) {
  return uuidToGroup[uuid] ?? null;
}

// ============================================================================
// Status & Loading
// ============================================================================

// One shared widget controller instead of a private copy per view (#597).
const { setStatus, showProgress, updateProgress, hideProgress } =
  createProgressUi(el);

// ============================================================================
// Theme mode — delegated to shared/theme.js
// ============================================================================

function isSameOriginUrl(url) {
  try {
    const u = new URL(String(url), window.location.href);
    return u.origin === window.location.origin;
  } catch (_e) {
    return false;
  }
}

function isSnapshotCacheAllowedUrl(url) {
  // We cache same-origin snapshots and the official Snapshot hosts so the app
  // remains usable offline without caching arbitrary third-party URLs.
  // Canonical origin list: shared/config.js ALLOWED_SNAPSHOT_ORIGINS (Issue #125).
  try {
    const u = new URL(String(url), window.location.href);
    if (u.origin === window.location.origin) return true;
    if (ALLOWED_SNAPSHOT_ORIGINS.includes(u.origin)) return true;
  } catch (_e) {
    // Fall through.
  }
  return false;
}

// Cache metadata transport between `fetchJson` and `loadSnapshot`.
//
// IMPORTANT: Use a Symbol so this cannot collide with user snapshot JSON keys
// when loading local files (Issue #25, 29-Dec-2025).
const LOADED_FROM_CACHE = Symbol("neat-ai-explore.loadedFromCache");

function maybeAnnotateLoadedFromCache(obj, usedCache, cacheReason) {
  // Strict mode: `JSON.parse()` (and `res.json()`) can return `null` or a
  // primitive. Only objects can be annotated safely.
  if (usedCache && obj && typeof obj === "object") {
    obj[LOADED_FROM_CACHE] = cacheReason || true;
  }
  return obj;
}

// Maximum number of retry attempts for transient network failures (Issue #67).
// The first fetch can fail during Service Worker activation or on unstable
// connections. Automatic retries make the app more resilient.
const FETCH_MAX_RETRIES = 2;

// Initial delay (ms) before the first retry. Doubles on each subsequent retry
// (exponential backoff) to give transient issues time to resolve.
const FETCH_RETRY_DELAY_MS = 500;

async function fetchJson(url) {
  const u = normaliseSnapshotUrl(url);
  const canUseCacheFallback = isSnapshotCacheAllowedUrl(u) &&
    typeof caches !== "undefined" &&
    typeof caches.match === "function";

  let res;
  let usedCache = false;
  let cacheReason = "";

  // Network-first with retry: attempt the fresh version, retrying on transient
  // network failures (Issue #67). This handles the common "first fetch fails,
  // second works" scenario during Service Worker activation or on unstable
  // mobile connections.
  let lastError = null;
  for (let attempt = 0; attempt <= FETCH_MAX_RETRIES; attempt++) {
    try {
      // `no-cache` tells the browser to revalidate when possible, while still
      // allowing offline use of cached responses when the network is down.
      res = await fetch(u, { cache: "no-cache" });
      // Success - break out of retry loop.
      lastError = null;
      break;
    } catch (e) {
      lastError = e;

      // Browser blocks cross-origin fetches without CORS headers (common with S3 presigned URLs).
      // fetch() rejects with TypeError("Failed to fetch") in that case.
      // However, same-origin URLs cannot have CORS issues - "Failed to fetch" for
      // same-origin URLs is more likely an offline/network error (especially on Chrome).
      // Only throw the CORS error for cross-origin URLs; same-origin should proceed
      // to cache fallback.
      if (e?.message === "Failed to fetch" && !canUseCacheFallback) {
        throw new Error(
          "Failed to fetch (likely CORS). If this is an S3 presigned URL, add a bucket CORS rule allowing origin https://stsoftwareau.github.io (GET/HEAD).",
        );
      }

      // If this wasn't our last attempt, wait before retrying (exponential backoff).
      if (attempt < FETCH_MAX_RETRIES) {
        const delay = FETCH_RETRY_DELAY_MS * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      // All retries exhausted - try fallback URLs for the default snapshot.
      // GitHub Pages can be blocked by CORS on some networks.
      if (String(url) === DEFAULT_SNAPSHOT_URL) {
        for (const fallback of SNAPSHOT_FALLBACK_URLS) {
          if (!fallback || fallback === url) continue;
          try {
            return await fetchJson(fallback);
          } catch (_e2) {
            // Keep trying.
          }
        }
      }

      // Offline/unstable network: fall back to Cache Storage when available.
      if (canUseCacheFallback) {
        const cached = await caches.match(u);
        if (cached) {
          res = cached;
          usedCache = true;
          cacheReason = "offline";
        }
      }

      if (!res) throw e;
    }
  }

  // If the network returned an error (e.g., 503), try cache fallback (same-origin only).
  if (res && !res.ok && canUseCacheFallback) {
    const failedStatus = res.status;
    const cached = await caches.match(u);
    if (cached) {
      res = cached;
      usedCache = true;
      cacheReason = `HTTP ${failedStatus}`;
    }
  }

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  // Best-effort: store the successful response so the app remains usable offline,
  // even when the Service Worker isn't ready yet.
  if (!usedCache && res.ok && canUseCacheFallback) {
    try {
      const cache = await caches.open("neat-ai-explore-snapshots");
      await cache.put(u, res.clone());
    } catch (_e) {
      // Non-fatal: caching can fail in some privacy modes.
    }
  }

  const ce = (res.headers.get("content-encoding") ?? "").toLowerCase();
  const ct = (res.headers.get("content-type") ?? "").toLowerCase();
  const contentLength = res.headers.get("content-length");
  const totalBytes = contentLength ? parseInt(contentLength, 10) : null;
  const looksGz = String(url).toLowerCase().includes(".gz") ||
    ct.includes("gzip") || ct.includes("application/x-gzip");

  // If S3 serves Content-Encoding: gzip then fetch transparently decompresses.
  // We still want to show progress, so we stream it.
  const needsClientDecompress = looksGz && !ce.includes("gzip");

  // Stream the response to track download progress.
  if (res.body && (totalBytes || needsClientDecompress)) {
    const reader = res.body.getReader();
    const chunks = [];
    let receivedBytes = 0;

    // Show indeterminate if we don't know the size
    if (totalBytes) {
      showProgress(false);
      updateProgress(0);
    } else {
      showProgress(true);
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      receivedBytes += value.length;
      if (totalBytes) {
        updateProgress((receivedBytes / totalBytes) * 100);
      }
    }

    // Combine chunks into a single buffer
    const allChunks = new Uint8Array(receivedBytes);
    let position = 0;
    for (const chunk of chunks) {
      allChunks.set(chunk, position);
      position += chunk.length;
    }

    // Decompress if needed
    if (needsClientDecompress) {
      const text = await gunzipToText(allChunks);
      const obj = JSON.parse(text);
      return maybeAnnotateLoadedFromCache(obj, usedCache, cacheReason);
    }

    // Parse JSON from the raw bytes
    const text = new TextDecoder().decode(allChunks);
    const obj = JSON.parse(text);
    return maybeAnnotateLoadedFromCache(obj, usedCache, cacheReason);
  }

  // Fallback: no streaming (e.g., body unavailable)
  if (looksGz && !ce.includes("gzip")) {
    const buf = new Uint8Array(await res.arrayBuffer());
    const text = await gunzipToText(buf);
    const obj = JSON.parse(text);
    return maybeAnnotateLoadedFromCache(obj, usedCache, cacheReason);
  }

  const obj = await res.json();
  return maybeAnnotateLoadedFromCache(obj, usedCache, cacheReason);
}

function normaliseCreature(snapshot) {
  const result = normaliseCreatureCore(snapshot);
  synapses = result.synapses;
  neuronsByUuid = result.neuronsByUuid;
  inboundByTo = result.inboundByTo;
  return result.creature;
}

async function loadSnapshot(source, label) {
  try {
    setStatus(`Loading ${label}...`);
    if (typeof source === "string") {
      showProgress(true); // Show indeterminate until we get content-length
    }
    const obj = typeof source === "string" ? await fetchJson(source) : source;
    hideProgress();
    const loadedFromCache = obj && typeof obj === "object" &&
      obj[LOADED_FROM_CACHE] != null;
    if (loadedFromCache) delete obj[LOADED_FROM_CACHE];

    SNAPSHOT = obj;
    loadInputLabelsFromSnapshot(SNAPSHOT);
    await applyFallbackTooltips();
    // Issue #273 — resolve the consumer contract once per snapshot load so
    // every calc-layer call site can pass the same value through.
    CONSUMER_CONTRACT = loadConsumerContract(SNAPSHOT);
    const creature = normaliseCreature(obj);
    clearTopInputCache();

    const neuronCount = (creature.neurons ?? []).filter((n) =>
      n.type !== "input"
    ).length;
    const inputCount = creature.input ?? 0;

    const baseStatus = `Observations: ${formatInteger(inputCount)}, Neurons: ${
      formatInteger(neuronCount)
    } & Synapses: ${formatInteger(synapses.length)}`;
    setStatus(
      loadedFromCache ? `${baseStatus} (cached)` : baseStatus,
      loadedFromCache ? "warn" : "ok",
    );

    const outputs = (creature.neurons ?? []).filter((n) => n.type === "output");
    const startUuid = outputs[0]?.uuid ?? "output-0";

    // Precompute diagnostics once per snapshot load (cheap, uses derived synapse contributions).
    try {
      const derivedSynapses = SNAPSHOT?.derived?.synapses ?? {};
      const recordingNeurons = SNAPSHOT?.recording?.neurons ?? {};
      DIAG_PRE = computePreActivations({
        neuronsByUuid,
        synapses,
        derivedSynapses,
        recordingNeurons,
      });
      DIAG_PRE_STATS = new Map(
        Array.from(DIAG_PRE.entries()).map(([uuid, arr]) => [
          uuid,
          summariseSeriesStats(arr, { sampleSize: 512 }),
        ]),
      );
      DIAG_SQUASH = computeSquashDerivativeStats({
        neuronsByUuid,
        preActivations: DIAG_PRE,
      });
      DIAG_PROXY = computeGradientProxyImpact({
        neuronsByUuid,
        synapses,
        preActivations: DIAG_PRE,
        outputUuids: outputs.map((o) => o.uuid),
        iterations: 8,
      });

      // Issues tab: cache cheap summaries so the UI stays snappy on large snapshots.
      DIAG_DEADZONES = new Map(
        Array.from(neuronsByUuid.entries()).map(([uuid, n]) => {
          const pre = DIAG_PRE.get(uuid) ?? [];
          return [uuid, summariseDeadZoneStats(n?.squash, pre)];
        }),
      );
      DIAG_NONFINITE = computeNonFiniteIssues({
        recording: SNAPSHOT?.recording ?? null,
      });
      DIAG_NOTRECORDED = computeNotRecordedIssues({
        recording: SNAPSHOT?.recording ?? null,
      });
      DIAG_ERROR_TAIL = computeErrorConcentrationIssues({
        recording: SNAPSHOT?.recording ?? null,
      });
      DISCOVERY_CANDIDATES = extractDiscoveryCandidates(SNAPSHOT);
      DIAG_INPUTS = computeInputIssues({
        recording: SNAPSHOT?.recording ?? null,
        inputCount: creature.input ?? 0,
        candidates: DISCOVERY_CANDIDATES,
      });

      // Observations dashboard (reachability + low-signal flags).
      INPUT_DASH = computeInputDashboard({
        synapses,
        inputCount: creature.input ?? 0,
        outputUuids: outputs.map((o) => o.uuid),
        proxy: DIAG_PROXY,
        constantInputs: DIAG_INPUTS?.constantInputs ?? [],
        candidateCoverage: DIAG_INPUTS?.candidateCoverage ?? [],
      });
    } catch (e) {
      console.warn("Impact diagnostics failed (non-fatal):", e);
      DIAG_PRE = new Map();
      DIAG_PRE_STATS = new Map();
      DIAG_SQUASH = new Map();
      DIAG_PROXY = new Map();
      DIAG_DEADZONES = new Map();
      DIAG_NONFINITE = new Map();
      DIAG_NOTRECORDED = new Map();
      DIAG_ERROR_TAIL = new Map();
      DIAG_INPUTS = {
        constantInputs: [],
        correlatedPairs: [],
        candidateCoverage: [],
      };
      DISCOVERY_CANDIDATES = [];
      INPUT_DASH = { inputCount: creature.input ?? 0, rows: [] };
    }

    selectedCandidateKey = null;
    currentNeuronTab = "details";
    trace = [];

    // Show overview dashboard first (#103), then let user drill in.
    renderOverviewDashboard();

    // Issue #53/#116: Hide URL/Fetch/Browse controls once snapshot loads.
    document.body.classList.add("snapshotLoaded");
  } catch (e) {
    hideProgress();
    setStatus(e.message, "bad");
    console.error(e);
  }
}

// ============================================================================
// Observations dashboard (unused inputs + redundancy)
// ============================================================================

function computeInputDashboard(
  {
    synapses,
    inputCount,
    outputUuids,
    proxy,
    constantInputs,
    candidateCoverage,
  },
) {
  const nInputs = Math.max(0, Math.floor(inputCount ?? 0));
  const { incomingByTo, outgoingByFrom } = buildGraphIndex(synapses);
  const reachable = computeReachableToOutputs({ outputUuids, incomingByTo });

  /** @type {Set<string>} */
  const constantSet = new Set(
    (Array.isArray(constantInputs) ? constantInputs : []).map((x) => x.uuid)
      .filter(Boolean),
  );

  /** @type {Map<string, any>} */
  const covByUuid = new Map(
    (Array.isArray(candidateCoverage) ? candidateCoverage : []).map((c) => [
      c.uuid,
      c,
    ]),
  );

  const rows = [];
  for (let i = 0; i < nInputs; i++) {
    const uuid = `input-${i}`;
    const alias = getAlias(uuid);
    const description = getInputDescription(uuid);
    const group = getInputGroup(uuid);
    const outDegree = outgoingByFrom.get(uuid)?.length ?? 0;
    const p = proxy?.get?.(uuid);
    const cov = covByUuid.get(uuid) ?? null;

    rows.push({
      uuid,
      alias,
      description,
      group,
      reachable: reachable.has(uuid),
      outDegree,
      proxy: typeof p === "number" && isFinite(p) ? p : null,
      constant: constantSet.has(uuid),
      candidates: cov,
    });
  }

  return { inputCount: nInputs, rows };
}

let obsFilter = {
  search: "",
  showUnusedOnly: false,
  showConstantOnly: false,
  sort: "proxyDesc", // proxyDesc | unusedFirst | uuid
};

function openObsModal() {
  if (!el.obsModal || !el.obsModalBody || !el.obsModalTitle) return;
  _modalTrigger = document.activeElement;
  el.obsModal.classList.add("isOpen");
  el.obsModal.setAttribute("aria-hidden", "false");
  renderObsModal();
  const panel = el.obsModal.querySelector(".modalPanel");
  if (panel) {
    const target = getInitialFocusTarget(panel);
    if (target) target.focus();
    _focusTrapCleanup = installFocusTrap(panel);
  }
}

function closeObsModal() {
  if (!el.obsModal) return;
  el.obsModal.classList.remove("isOpen");
  el.obsModal.setAttribute("aria-hidden", "true");
  if (_focusTrapCleanup) {
    _focusTrapCleanup();
    _focusTrapCleanup = null;
  }
  if (_modalTrigger && typeof _modalTrigger.focus === "function") {
    _modalTrigger.focus();
    _modalTrigger = null;
  }
}

function renderObsModal() {
  if (!el.obsModalBody || !SNAPSHOT) return;

  const rows = Array.isArray(INPUT_DASH?.rows) ? INPUT_DASH.rows : [];
  const total = rows.length;
  const unused = rows.filter((r) => !r.reachable).length;
  const constant = rows.filter((r) => !!r.constant).length;

  const search = String(obsFilter.search ?? "").trim().toLowerCase();

  const filtered = rows.filter((r) => {
    if (obsFilter.showUnusedOnly && r.reachable) return false;
    if (obsFilter.showConstantOnly && !r.constant) return false;
    if (!search) return true;

    const hay = [
      r.uuid,
      r.alias ?? "",
      r.description ?? "",
      r.group ?? "",
    ].join(" ").toLowerCase();
    return hay.includes(search);
  });

  filtered.sort((a, b) => {
    const sa = obsFilter.sort;
    if (sa === "unusedFirst") {
      if (a.reachable !== b.reachable) return a.reachable ? 1 : -1;
      return (b.proxy ?? 0) - (a.proxy ?? 0);
    }
    if (sa === "uuid") return String(a.uuid).localeCompare(String(b.uuid));
    // proxyDesc
    return (b.proxy ?? 0) - (a.proxy ?? 0);
  });

  // Group summary (simple counts, based on the full set).
  /** @type {Map<string, { total: number, unused: number }>} */
  const groupAgg = new Map();
  for (const r of rows) {
    const g = String(r.group ?? "").trim();
    if (!g) continue;
    const prev = groupAgg.get(g) ?? { total: 0, unused: 0 };
    prev.total += 1;
    if (!r.reachable) prev.unused += 1;
    groupAgg.set(g, prev);
  }
  const topGroups = Array.from(groupAgg.entries())
    .sort((a, b) => (b[1].total ?? 0) - (a[1].total ?? 0))
    .slice(0, 8);

  const summary = `
    <div class="obsSummary">
      <span class="stat" title="Total observations (inputs)">inputs: ${
    escapeHtml(String(total))
  }</span>
      <span class="stat" title="Inputs that cannot reach any output via synapses">unused: ${
    escapeHtml(String(unused))
  }</span>
      <span class="stat" title="Inputs with near-zero variance across samples">near-constant: ${
    escapeHtml(String(constant))
  }</span>
      <span class="stat" title="After search/filters">shown: ${
    escapeHtml(String(filtered.length))
  }</span>
    </div>
    ${
    topGroups.length
      ? `<div class="obsSummary">${
        topGroups.map(([g, d]) =>
          `<span class="stat" title="Group: total (unused)">${escapeHtml(g)}: ${
            escapeHtml(String(d.total))
          } (${escapeHtml(String(d.unused))})</span>`
        ).join("")
      }</div>`
      : ""
  }
  `;

  const controls = `
    <div class="obsControls">
      <label class="filterItem">
        <span>Search</span>
        <input id="obsSearch" class="input inputSmall" placeholder="uuid / label" value="${
    escapeHtml(obsFilter.search)
  }" />
      </label>
      <label class="filterItem">
        <span>Sort</span>
        <select id="obsSort" class="select selectSmall">
          <option value="proxyDesc"${
    obsFilter.sort === "proxyDesc" ? " selected" : ""
  }>Proxy influence ↓</option>
          <option value="unusedFirst"${
    obsFilter.sort === "unusedFirst" ? " selected" : ""
  }>Unused first</option>
          <option value="uuid"${
    obsFilter.sort === "uuid" ? " selected" : ""
  }>UUID</option>
        </select>
      </label>
      <label class="filterItem filterCheckbox">
        <input id="obsUnusedOnly" type="checkbox"${
    obsFilter.showUnusedOnly ? " checked" : ""
  } />
        <span>Unused only</span>
      </label>
      <label class="filterItem filterCheckbox">
        <input id="obsConstantOnly" type="checkbox"${
    obsFilter.showConstantOnly ? " checked" : ""
  } />
        <span>Near-constant only</span>
      </label>
    </div>
  `;

  const listHtml = filtered.slice(0, 300).map((r) => {
    const alias = r.alias
      ? `<span class="obsAlias">${escapeHtml(r.alias)}</span>`
      : "";
    const uuid = `<span class="obsUuid">${escapeHtml(r.uuid)}</span>`;
    const desc = r.description
      ? `<div class="obsRowMuted">${escapeHtml(r.description)}</div>`
      : "";

    const chips = [];
    chips.push(
      `<span class="stat" title="Outgoing synapses count">out: ${
        escapeHtml(String(r.outDegree ?? 0))
      }</span>`,
    );
    if (r.group) {
      chips.push(
        `<span class="stat" title="Observation group">${
          escapeHtml(String(r.group))
        }</span>`,
      );
    }
    if (!r.reachable) {
      chips.push(
        `<span class="stat error" title="No path from this input to any output (structurally unused)">unused</span>`,
      );
    }
    if (r.constant) {
      chips.push(
        `<span class="stat" title="Near-constant input (std dev ~0)">constant</span>`,
      );
    }
    if (r.proxy != null) {
      chips.push(
        `<span class="stat" title="Viewer proxy influence (diagnostic)">proxy: ${
          escapeHtml(formatSig(r.proxy, 3))
        }</span>`,
      );
    }
    if (r.candidates) {
      chips.push(
        `<span class="stat" title="Discovery candidate references">cand: ${
          escapeHtml(String(r.candidates.count ?? 0))
        }</span>`,
      );
    }

    // Issue #521 — hovering the row shows the observation's summary.
    const rowTitle = buildObservationTooltip({
      uuid: r.uuid,
      label: r.alias ? `${r.alias} (${r.uuid})` : r.uuid,
      description: r.description,
    });

    return `
      <div class="obsRow" data-obs-uuid="${escapeHtml(r.uuid)}" title="${
      escapeHtml(rowTitle)
    }">
        <div class="obsRowTitle">${alias}${uuid}</div>
        <div class="synapseStats">${chips.join("")}</div>
        ${desc}
      </div>
    `;
  }).join("");

  const truncated = filtered.length > 300
    ? `<div class="emptyState">Showing first 300 (use search/filters to narrow).</div>`
    : "";

  el.obsModalBody.innerHTML = summary + controls +
    `<div class="obsList">${
      listHtml ||
      `<div class="emptyState">No observations match these filters.</div>`
    }</div>` +
    truncated;

  // Wire controls.
  el.obsModalBody.querySelector("#obsSearch")?.addEventListener(
    "input",
    (e) => {
      obsFilter.search = e.target.value;
      renderObsModal();
    },
  );
  el.obsModalBody.querySelector("#obsSort")?.addEventListener("change", (e) => {
    obsFilter.sort = e.target.value;
    renderObsModal();
  });
  el.obsModalBody.querySelector("#obsUnusedOnly")?.addEventListener(
    "change",
    (e) => {
      obsFilter.showUnusedOnly = !!e.target.checked;
      renderObsModal();
    },
  );
  el.obsModalBody.querySelector("#obsConstantOnly")?.addEventListener(
    "change",
    (e) => {
      obsFilter.showConstantOnly = !!e.target.checked;
      renderObsModal();
    },
  );

  // Row click navigates to input (and closes).
  el.obsModalBody.onclick = (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;
    const row = target.closest("[data-obs-uuid]");
    if (!row) return;
    const uuid = row.getAttribute("data-obs-uuid");
    if (!uuid) return;
    closeObsModal();
    navigateTo(uuid);
  };
}

// ============================================================================
// Data Accessors
// ============================================================================

function getImpacts() {
  const derived = SNAPSHOT?.derived;
  return derived?.impactsByNeuronUuid ?? derived?.impacts_by_neuron_uuid ?? {};
}

function getNeuronImpact(uuid) {
  return getImpacts()[uuid] ?? null;
}

function getNeuronStats(uuid) {
  return SNAPSHOT?.recording?.neurons?.[uuid]?.stats ?? null;
}

// Get MSE - matches production creature scoring
function getMSE(uuid) {
  const stats = getNeuronStats(uuid);
  return stats?.meanSquaredError ?? stats?.mean_squared_error ?? null;
}

// Get MAE - used in focus neuron ranking
function getMAE(uuid) {
  const stats = getNeuronStats(uuid);
  return stats?.meanAbsoluteError ?? stats?.mean_absolute_error ?? null;
}

function getMeanContribution(fromUuid, toUuid) {
  const key = `${fromUuid}→${toUuid}`;
  const synData = SNAPSHOT?.derived?.synapses?.[key];
  return synData?.stats?.meanContribution ??
    synData?.stats?.mean_contribution ?? null;
}

/**
 * Per-observation contribution series (weight × activation) for a synapse
 * (Issue #513). Used by selection-squash (MINIMUM/MAXIMUM) win-fraction
 * attribution. Resolution order:
 *   1. `recording.synapses[from→to].contribution` (or `.contributions`), if
 *      the snapshot records per-synapse series directly.
 *   2. Fallback: `recording.neurons[from].activation` × `weight`.
 * Returns `null` when neither source is available, in which case the
 * allocation falls back to an even split.
 *
 * @param {string} fromUuid
 * @param {string} toUuid
 * @param {number} weight
 * @returns {number[] | null}
 */
function getSynapseContributions(fromUuid, toUuid, weight) {
  const rec = SNAPSHOT?.recording;
  if (!rec) return null;

  const syn = rec.synapses;
  if (syn) {
    const key = `${fromUuid}→${toUuid}`;
    const entry = Array.isArray(syn)
      ? syn.find((s) => s?.fromUuid === fromUuid && s?.toUuid === toUuid)
      : (syn[key] ?? syn[`${fromUuid}->${toUuid}`]);
    const c = entry?.contribution ?? entry?.contributions;
    if (Array.isArray(c)) return c;
  }

  // Fallback: reconstruct from the source neuron's recorded activation series.
  const act = rec.neurons?.[fromUuid]?.activation;
  if (Array.isArray(act) && typeof weight === "number" && isFinite(weight)) {
    return act.map((a) => (typeof a === "number" ? a * weight : NaN));
  }
  return null;
}

function getReconstructionCheck(uuid) {
  const reconChecks = SNAPSHOT?.derived?.reconstructionChecks ??
    SNAPSHOT?.derived?.reconstruction_checks ?? [];
  return reconChecks.find((c) => (c.neuronUuid ?? c.neuron_uuid) === uuid) ??
    null;
}

// ============================================================================
// Navigation
// ============================================================================

function navigateTo(uuid) {
  if (!neuronsByUuid.has(uuid) && !uuid.startsWith("input-")) {
    setStatus(`Unknown neuron: ${uuid}`, "bad");
    return;
  }

  const isGoingBack = trace.indexOf(uuid) >= 0;
  const existingIndex = trace.indexOf(uuid);
  if (existingIndex >= 0) {
    trace = trace.slice(0, existingIndex + 1);
  } else {
    trace.push(uuid);
  }

  renderWithTransition(uuid, isGoingBack ? "back" : "deeper");
}

function goBack() {
  if (trace.length > 1) {
    trace.pop();
    const uuid = trace[trace.length - 1];
    renderWithTransition(uuid, "back");
  }
}

/**
 * Render the neuron panel, breadcrumb, and synapse list with animated
 * transitions. When `prefers-reduced-motion: reduce` is active, or when
 * the panel element is missing, falls back to an instant swap.
 *
 * @param {string} uuid - Neuron UUID to display.
 * @param {"deeper"|"back"} direction - Navigation direction for breadcrumb slide.
 */
function renderWithTransition(uuid, direction) {
  const panel = document.querySelector(".currentNeuron");
  const reduced = prefersReducedMotion();

  if (!panel || reduced) {
    // Instant swap (no animation).
    renderTrace();
    renderCurrentNeuron(uuid);
    resetInboundRenderLimit();
    renderSynapseList(uuid, { animate: false });
    return;
  }

  // Cross-fade: fade out → update → fade in.
  panel.classList.add("transitionOut");

  // Breadcrumb directional slide.
  el.traceBreadcrumb.classList.remove("slideDeeper", "slideBack");

  setTimeout(() => {
    renderTrace();
    renderCurrentNeuron(uuid);
    resetInboundRenderLimit();
    renderSynapseList(uuid, { animate: true });

    // Apply breadcrumb slide direction.
    const slideClass = direction === "back" ? "slideBack" : "slideDeeper";
    el.traceBreadcrumb.classList.add(slideClass);

    panel.classList.remove("transitionOut");
    panel.classList.add("transitionIn");

    // Allow one frame for the browser to apply the transitionIn class,
    // then remove it to trigger the CSS transition back to full opacity.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        panel.classList.remove("transitionIn");
      });
    });

    // Clean up breadcrumb slide class after the animation completes.
    setTimeout(() => {
      el.traceBreadcrumb.classList.remove("slideDeeper", "slideBack");
    }, 200);
  }, PANEL_CROSSFADE_MS);
}

function clearTrace() {
  if (SNAPSHOT) {
    // Return to the overview dashboard (#103).
    trace = [];
    showOverviewDashboard();
  }
  // Issue #53/#116: Show URL/Fetch/Browse controls again.
  document.body.classList.remove("snapshotLoaded");
}

// ============================================================================
// Render Functions
// ============================================================================

function renderTrace() {
  el.traceBreadcrumb.innerHTML = "";

  // Issue #184: keep the "Score:" badge next to "Path:" in sync with the
  // current step of the trace so phone users can see the inbound-allocation
  // score without opening the path-summary modal.
  renderTraceScore();

  // Build the list of items to display, truncating in the middle if needed.
  // When path is long, show: first 2 → … → last 2
  // This preserves the origin (output neuron) and current position.
  const itemsToShow = getPathItemsWithMiddleTruncation(trace);

  itemsToShow.forEach((item) => {
    const li = document.createElement("li");

    if (item.isEllipsis) {
      // Render ellipsis indicator for truncated middle section
      const span = document.createElement("span");
      span.className = "breadcrumbEllipsis";
      span.textContent = "…";
      span.title = `${item.hiddenCount} item${
        item.hiddenCount === 1 ? "" : "s"
      } hidden`;
      li.appendChild(span);
    } else {
      // Render normal breadcrumb button
      const btn = document.createElement("button");
      btn.textContent = truncateNeuronName(item.uuid);
      const alias = getAlias(item.uuid);
      const desc = getInputDescription(item.uuid);
      btn.title = item.uuid +
        (alias ? ` (${alias})` : "") +
        (desc ? ` — ${desc}` : "");
      btn.onclick = () => navigateTo(item.uuid);
      li.appendChild(btn);
    }

    el.traceBreadcrumb.appendChild(li);
  });
}

/**
 * Issue #184: update the "Score:" badge that sits next to the "Path:" label
 * in the trace nav row. The badge shows the current (deepest) neuron's
 * impact as a compact percentage. When there is no trace yet, the badge is
 * hidden so it does not consume horizontal space.
 */
function renderTraceScore() {
  if (!el.traceScore) return;
  const currentUuid = trace.length > 0 ? trace[trace.length - 1] : null;
  if (!currentUuid) {
    el.traceScore.hidden = true;
    el.traceScore.textContent = "";
    return;
  }
  const impact = getNeuronImpact(currentUuid);
  const label = formatTraceScore(impact);
  el.traceScore.textContent = `Score: ${label}`;
  el.traceScore.hidden = false;
}

/**
 * Issue #184: wire the "⋯" overflow button in the trace nav row.
 *
 * On phone viewports the secondary trace actions (Observations, 🧠,
 * Synapses) collapse into a popup menu so Back/Clear stay always visible.
 * On wider viewports CSS keeps the wrapper transparent (display: contents),
 * so the children flow inline — the overflow button is hidden and this
 * handler is a no-op for menu visibility.
 */
function initTraceOverflowMenu() {
  // Idempotent wiring lives in the shared module (Issue #383) so calling
  // this more than once cannot bind duplicate toggle handlers.
  wireTraceOverflowMenu(document.querySelector(".traceOverflow"), document);
}

/**
 * Given a trace array, returns items to display with middle truncation
 * when the path exceeds MAX_VISIBLE_PATH_ITEMS.
 *
 * For a path like [A, B, C, D, E, F, G], returns:
 * [A, B, {ellipsis, hiddenCount: 3}, F, G]
 *
 * @param {string[]} pathArray - Array of neuron UUIDs
 * @returns {Array<{uuid: string, isEllipsis?: false} | {isEllipsis: true, hiddenCount: number}>}
 */
function getPathItemsWithMiddleTruncation(pathArray) {
  if (pathArray.length <= MAX_VISIBLE_PATH_ITEMS) {
    // No truncation needed
    return pathArray.map((uuid) => ({ uuid, isEllipsis: false }));
  }

  // Truncate in the middle: show first 2, ellipsis, last 2
  const headCount = 2;
  const tailCount = 2;
  const head = pathArray.slice(0, headCount);
  const tail = pathArray.slice(-tailCount);
  const hiddenCount = pathArray.length - headCount - tailCount;

  return [
    ...head.map((uuid) => ({ uuid, isEllipsis: false })),
    { isEllipsis: true, hiddenCount },
    ...tail.map((uuid) => ({ uuid, isEllipsis: false })),
  ];
}

function truncateUuid(uuid) {
  if (uuid.length <= 16) return uuid;
  return uuid.slice(0, 8) + "…" + uuid.slice(-4);
}

function truncateNeuronName(uuid) {
  const alias = getAlias(uuid);
  if (alias) {
    // Issue #512 — return the full alias; row labels now flex into the
    // available width and CSS `text-overflow: ellipsis` is the single
    // truncation mechanism, so no JS hard-truncation is applied here.
    return alias;
  }
  return truncateUuid(uuid);
}

// Full, untruncated neuron name for a row's `title` attribute (Issue #512) so
// any label still clipped by CSS overflow remains readable on hover. When the
// neuron is an observation with a Tooltips.json summary, the summary is
// appended so hovering explains what the observation means (Issue #521).
function fullNeuronName(uuid) {
  const alias = getAlias(uuid);
  return buildObservationTooltip({
    uuid,
    label: alias ? `${alias} (${uuid})` : uuid,
    description: getInputDescription(uuid),
  });
}

function getImpactClass(impact) {
  if (impact == null) return "";
  if (impact > IMPACT_HIGHLIGHT_THRESHOLD) return "highlight";
  if (impact < IMPACT_SUSPICIOUS_THRESHOLD && impact >= 0) return "suspicious";
  return "";
}

// ── Sparkline & histogram SVG renderers (#107) ─────────────────────────

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Render a sparkline as an inline SVG element.
 *
 * @param {{ points: Array<{x: number, y: number}>, min: number, max: number }} data
 * @param {{ currentIndex: number|null, totalObs: number }} opts
 * @returns {SVGSVGElement}
 */
function renderSparklineSVG(data, opts = {}) {
  const W = 200;
  const H = 40;
  const PAD = 2;

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("class", "sparkline");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Activation sparkline");

  if (data.points.length === 0) return svg;

  // Build polyline path
  const pts = data.points.map((p) => {
    const x = PAD + p.x * (W - 2 * PAD);
    const y = H - PAD - p.y * (H - 2 * PAD);
    return `${x},${y}`;
  });

  const polyline = document.createElementNS(SVG_NS, "polyline");
  polyline.setAttribute("points", pts.join(" "));
  polyline.setAttribute("class", "sparklineLine");
  svg.appendChild(polyline);

  // Current observation marker
  if (
    opts.currentIndex != null && opts.totalObs > 0 &&
    opts.currentIndex >= 0 && opts.currentIndex < data.points.length
  ) {
    const cp = data.points[opts.currentIndex];
    const cx = PAD + cp.x * (W - 2 * PAD);
    const cy = H - PAD - cp.y * (H - 2 * PAD);
    const dot = document.createElementNS(SVG_NS, "circle");
    dot.setAttribute("cx", String(cx));
    dot.setAttribute("cy", String(cy));
    dot.setAttribute("r", "3");
    dot.setAttribute("class", "sparklineDot");
    svg.appendChild(dot);
  }

  return svg;
}

/**
 * Render an error histogram as a mini SVG bar chart.
 *
 * @param {{ buckets: Array<{ratio: number}>, min: number, max: number }} histo
 * @returns {SVGSVGElement}
 */
function renderErrorHistogramSVG(histo) {
  const W = 200;
  const H = 32;
  const n = histo.buckets.length;
  const barW = W / n;

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("class", "errorHistogram");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Error distribution histogram");

  for (let i = 0; i < n; i++) {
    const b = histo.buckets[i];
    const barH = Math.max(1, b.ratio * (H - 2));
    const x = i * barW;
    const y = H - barH;

    // Colour: green (low error) → red (high error) based on bucket position
    const t = n === 1 ? 0 : i / (n - 1);
    const r = Math.round(34 + t * 214);
    const g = Math.round(197 - t * 150);
    const bl = Math.round(99 - t * 60);

    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", String(x + 0.5));
    rect.setAttribute("y", String(y));
    rect.setAttribute("width", String(Math.max(1, barW - 1)));
    rect.setAttribute("height", String(barH));
    rect.setAttribute("fill", `rgb(${r},${g},${bl})`);
    rect.setAttribute("rx", "1");
    svg.appendChild(rect);
  }

  return svg;
}

/**
 * Render the "Gate" indicator chip on the neuron card (Issue #273).
 *
 * The chip appears whenever any inbound input to the focused neuron is
 * masked by a downstream `min(...)` consumer gate. When no gating applies
 * the chip is removed so the card stays clean.
 *
 * @param {string} uuid — focused neuron UUID.
 */
function renderGateChip(uuid) {
  const titleEl = el.currentNeuronTitle;
  if (!titleEl?.parentElement) return;

  // Remove any chip from a previous render so we don't accumulate.
  const existing = titleEl.parentElement.querySelector(
    `[data-role="gate-chip"]`,
  );
  if (existing) existing.remove();

  if (!CONSUMER_CONTRACT) return;

  const inbound = getInboundSynapses(uuid);
  if (!inbound || inbound.length === 0) return;

  // Build pre-allocation rows so we can decide whether any input is gated
  // without paying for the full impact allocation.
  const rows = inbound
    .filter((s) => typeof s.fromUuid === "string")
    .map((s) => ({
      gateMaskedFraction: s.fromUuid.startsWith("input-")
        ? 1 - computeInputActiveFraction(CONSUMER_CONTRACT, s.fromUuid)
        : 0,
    }));

  const chipHtml = buildGateChipHtml({
    rows,
    gateUrl: "#consumer-contract",
    label: "Gate",
  });
  if (!chipHtml) return;

  // Render as a sibling of the title so the chip floats next to it.
  const wrap = document.createElement("span");
  wrap.className = "gateChipWrap";
  wrap.innerHTML = chipHtml;
  const node = wrap.firstElementChild;
  if (node) titleEl.insertAdjacentElement("afterend", node);
}

function renderCurrentNeuron(uuid) {
  const n = neuronsByUuid.get(uuid) ??
    { uuid, type: "input", squash: "IDENTITY", bias: 0 };
  const alias = getAlias(uuid);
  const desc = getInputDescription(uuid);
  const isInput = uuid.startsWith("input-");
  let diagPreStats = null;

  // Ensure we have a dedicated description block under the neuron title.
  // iOS Safari/PWA doesn't reliably show `title` tooltips on tap.
  let descEl = document.getElementById("currentNeuronDesc");
  if (!descEl && el.currentNeuronTitle?.parentElement) {
    descEl = document.createElement("div");
    descEl.id = "currentNeuronDesc";
    descEl.className = "neuronDescription";
    el.currentNeuronTitle.insertAdjacentElement("afterend", descEl);
  }

  if (alias) {
    el.currentNeuronTitle.innerHTML =
      `<span class="aliasName" title="${desc ? escapeHtml(desc) : ""}">${
        escapeHtml(alias)
      }</span>` +
      `<span class="uuidSmall">${escapeHtml(uuid)}</span>`;
  } else {
    el.currentNeuronTitle.textContent = uuid;
  }

  if (descEl) {
    if (desc && String(desc).trim().length > 0) {
      descEl.textContent = String(desc).trim();
      descEl.style.display = "";
    } else {
      descEl.textContent = "";
      descEl.style.display = "none";
    }
  }

  // Issue #273 — Gate indicator chip. Surfaces a small "Gate" badge on the
  // neuron card whenever any inbound input is masked by a downstream
  // min(...) gate. The chip links to the gate definition in the snapshot
  // overview when a gate is found.
  renderGateChip(uuid);

  const stats = getNeuronStats(uuid);
  const impact = getNeuronImpact(uuid);
  const check = getReconstructionCheck(uuid);

  // Populate diagPreStats for use in diagnostics and error cards.
  if (!isInput) {
    diagPreStats = DIAG_PRE_STATS.get(uuid) ?? null;
  }

  el.neuronProps.innerHTML = "";

  // ── Helper: create a card with a title and a <dl> of props ────────────
  const reduceMotion = prefersReducedMotion();

  function makeCard(title, rows, index) {
    const card = document.createElement("div");
    card.className = "neuronCard";
    if (!reduceMotion) {
      card.style.animationDelay = `${index * 40}ms`;
    } else {
      card.classList.add("noMotion");
    }

    const heading = document.createElement("h3");
    heading.className = "neuronCardTitle";
    heading.textContent = title;
    card.appendChild(heading);

    const dl = document.createElement("dl");
    dl.className = "propList";
    for (const row of rows) {
      const [label, value, cls, valueTitle, meta] = row;
      const dt = document.createElement("dt");
      dt.textContent = label;
      if (TOOLTIPS[label]) {
        dt.title = TOOLTIPS[label];
        dt.classList.add("hasTooltip");
      }
      const dd = document.createElement("dd");
      dd.textContent = value;
      if (cls) dd.className = cls;
      if (valueTitle) dd.title = valueTitle;
      if (meta?.issuesTabLink && el.neuronTabIssues) {
        const open = document.createTextNode(" (");
        const link = document.createElement("a");
        link.href = "#";
        link.className = "inlineLink";
        link.textContent = "Issues tab";
        link.onclick = (ev) => {
          ev.preventDefault();
          setNeuronTab("issues");
          applyNeuronTabState();
        };
        const close = document.createTextNode(")");
        dd.appendChild(open);
        dd.appendChild(link);
        dd.appendChild(close);
      }
      dl.appendChild(dt);
      dl.appendChild(dd);
    }
    card.appendChild(dl);
    return card;
  }

  // ── Group props into themed cards ─────────────────────────────────────
  let cardIndex = 0;

  // Identity card (type, squash badge, bias, impact)
  const identityRows = [["Type", n.type ?? "unknown"]];
  if (!isInput) {
    const badge = squashBadge(n.squash);
    identityRows.push([
      "Squash",
      badge.label,
      "squashBadge squashBadge--" + badge.colour,
    ]);
    identityRows.push(["Bias", formatNumber(n.bias)]);
  }
  if (impact != null) {
    const impactClass = getImpactClass(impact);
    const impactNote = impact < IMPACT_SUSPICIOUS_THRESHOLD ? " ⚠️" : "";
    identityRows.push([
      "Impact",
      formatSig(impact, 3) + impactNote,
      impactClass,
    ]);
  }
  el.neuronProps.appendChild(makeCard("Identity", identityRows, cardIndex++));

  // Activation card (stats + sparkline)
  if (stats) {
    const actRows = [];
    actRows.push(["Mean Activation", formatNumber(stats.meanActivation)]);
    actRows.push([
      "Activation Range",
      `${formatNumber(stats.activationMin)} → ${
        formatNumber(stats.activationMax)
      }`,
    ]);
    actRows.push(["Samples", stats.recordCount ?? "N/A"]);
    const actCard = makeCard("Activation", actRows, cardIndex++);

    // Sparkline: show activation values across observations
    const rec = SNAPSHOT?.recording?.neurons?.[uuid];
    const actSeries = rec?.activation ?? rec?.value ?? null;
    if (Array.isArray(actSeries) && actSeries.length > 1) {
      const sparkResult = computeSparklinePoints(actSeries);
      if (sparkResult.points.length > 1) {
        const sparkEl = renderSparklineSVG(sparkResult, {
          currentIndex: null,
          totalObs: actSeries.length,
        });
        actCard.appendChild(sparkEl);
      }
    }

    el.neuronProps.appendChild(actCard);
  }

  // Pre-activation / diagnostics card (non-input only)
  if (!isInput) {
    const diagRows = [];
    if (diagPreStats && diagPreStats.n > 0) {
      diagRows.push(["Pre-activation mean", formatSig(diagPreStats.mean, 4)]);
      diagRows.push([
        "Pre-activation range",
        `${formatSig(diagPreStats.min, 4)} → ${formatSig(diagPreStats.max, 4)}`,
      ]);
      diagRows.push([
        "Pre-activation p99",
        formatSig(diagPreStats.p99, 4),
      ]);
      diagRows.push([
        "Pre-activation |x| max",
        formatSig(diagPreStats.maxAbs, 4),
      ]);
    }
    const proxy = DIAG_PROXY.get(uuid);
    if (typeof proxy === "number" && isFinite(proxy)) {
      diagRows.push(["Impact (proxy, grad)", formatSig(proxy, 3)]);
    }
    const s = DIAG_SQUASH.get(uuid);
    if (s) {
      diagRows.push(["Squash |d| mean", formatSig(s.meanAbsD, 3)]);
      diagRows.push([
        "Squash d≈0 %",
        formatSig(s.fracNearZero * 100, 3) + "%",
      ]);
      if (s.nonSmooth) {
        diagRows.push([
          "Squash warning",
          s.note ?? "non-smooth / branching",
          "error",
          squashWarningExplanation(s.note, n.squash),
        ]);
      }
    }
    if (diagRows.length > 0) {
      el.neuronProps.appendChild(
        makeCard("Diagnostics", diagRows, cardIndex++),
      );
    }
  }

  // Error metrics card (non-input only)
  if (!isInput && stats) {
    const errorRows = [];
    const mse = stats.meanSquaredError ?? stats.mean_squared_error;
    const mae = stats.meanAbsoluteError ?? stats.mean_absolute_error;
    if (mse != null) {
      const errorClass = mse > MSE_ERROR_THRESHOLD ? "error" : "";
      errorRows.push(["MSE", formatSig(mse, 3), errorClass]);
    }
    if (mae != null) {
      errorRows.push(["MAE", formatSig(mae, 3)]);
    }
    const extremePreActivation = diagPreStats &&
      typeof diagPreStats.maxAbs === "number" &&
      isFinite(diagPreStats.maxAbs) &&
      diagPreStats.maxAbs >= EXTREME_PREACTIVATION_ABS_MAX_FOR_STEP_BIPOLAR;
    if (
      (mse != null || mae != null) && isStepOrBipolarSquash(n.squash) &&
      extremePreActivation
    ) {
      errorRows.push([
        "MSE/MAE warning",
        "Value-domain error metrics can be dominated by saturation/outliers when STEP/BIPOLAR pre-activation is extreme.",
        "error",
        "If MSE/MAE look obviously wrong, inspect the Issues tab for error tails/outliers.",
        { issuesTabLink: true },
      ]);
    }
    if (errorRows.length > 0) {
      const errCard = makeCard("Error Metrics", errorRows, cardIndex++);

      // Error distribution mini-chart
      const rec = SNAPSHOT?.recording?.neurons?.[uuid];
      if (rec?.errors) {
        const flat = flattenErrors(rec.errors);
        if (flat.length > 0) {
          const histo = computeErrorHistogram(flat, 12);
          if (histo.buckets.length > 0) {
            const histoEl = renderErrorHistogramSVG(histo);
            errCard.appendChild(histoEl);
          }
        }
      }

      el.neuronProps.appendChild(errCard);
    }
  }

  // Reconstruction check card
  if (!isInput && check) {
    const maxDelta = check.maxActivationDelta ?? check.max_activation_delta;
    const deltaClass = maxDelta > 0.01 ? "error" : "";
    const reconRows = [["Max Recon Δ", formatSig(maxDelta, 3), deltaClass]];
    el.neuronProps.appendChild(
      makeCard("Reconstruction", reconRows, cardIndex++),
    );
  }

  renderImpactBreakdown(uuid, impact);
  renderImpactDiagnosticsPanel(uuid, n.type);
  renderObservationContributions(uuid, n.type);
  renderIssuesPanel(uuid, n.type);
  renderCandidatesPanel(uuid);
  applyNeuronTabState();
}

// ============================================================================
// \"Why this score\": top contributing inputs for the focused neuron
// ============================================================================

/** @type {Map<string, any>} */
let TOP_INPUT_CACHE = new Map();

function clearTopInputCache() {
  TOP_INPUT_CACHE = new Map();
}

function computeTopContributingInputs(focusUuid, opts = {}) {
  return computeTopContributingInputsCore({
    focusUuid,
    maxDepth: opts?.maxDepth,
    maxWork: opts?.maxWork,
    maxInboundPerNode: opts?.maxInboundPerNode,
    getInboundEdges: (toUuid) => {
      const inbound = inboundByTo.get(toUuid) ?? [];
      return inbound.map((s) => ({
        fromUuid: s.fromUuid,
        toUuid: s.toUuid,
        weight: s.weight,
        meanContribution: getMeanContribution(s.fromUuid, s.toUuid),
        // Issue #513 — per-observation series for selection-squash attribution.
        contributions: getSynapseContributions(s.fromUuid, s.toUuid, s.weight),
      }));
    },
    // Issue #270: propagate the squash cap at each hop so accumulated
    // upstream contribution cannot exceed any intermediate neuron's emit
    // ceiling.
    getNeuronSquash: (uuid) => neuronsByUuid.get(uuid)?.squash ?? null,
    getRecordedActivationMax: (uuid) => {
      const stats = getNeuronStats(uuid);
      if (typeof stats?.activationMax !== "number") return null;
      return Math.max(
        Math.abs(stats.activationMax),
        typeof stats?.activationMin === "number"
          ? Math.abs(stats.activationMin)
          : 0,
      );
    },
    // Issue #272 / #273 — credit gate-masked samples downstream.
    consumerContract: CONSUMER_CONTRACT,
  });
}

/**
 * Session-scoped user overrides for the "Observation contributions" panel's
 * collapsed/expanded state (#187). Keyed by focused output neuron UUID;
 * value is the user's explicit choice. Absent keys fall back to the
 * viewport default (collapsed on phone, expanded on tablet/desktop).
 *
 * @type {Map<string, "open" | "closed">}
 */
const OBSERVATION_CONTRIBUTIONS_TOGGLE = new Map();

/**
 * Current top-N value for the Observation contributions stepper (#243).
 * Initialised lazily from localStorage on first render so the panel still
 * renders if storage is unavailable.
 *
 * @type {number | null}
 */
let OBSERVATION_TOP_N = null;

function getObservationTopN() {
  if (OBSERVATION_TOP_N == null) {
    OBSERVATION_TOP_N = loadObservationTopN();
  }
  return OBSERVATION_TOP_N;
}

function setObservationTopN(value) {
  OBSERVATION_TOP_N = clampTopN(value);
  saveObservationTopN(OBSERVATION_TOP_N);
  return OBSERVATION_TOP_N;
}

/**
 * Debounced re-render trigger for stepper changes (#243). Kept module-scoped
 * so successive keystrokes coalesce into one re-render.
 */
const _observationTopNDebounce = createDebounce((uuid, neuronType) => {
  renderObservationContributions(uuid, neuronType);
}, 150);

/**
 * Observation contributions panel (Issue #186).
 *
 * Renders the top 50 input observations ranked by their multi-hop share of
 * the focused output neuron. Only rendered on output neuron cards; hidden
 * and input neurons clear the panel and bail.
 *
 * On phone viewports (≤520px, matching `isNarrowMobile()`) the panel is
 * collapsed by default to respect the compact-layout decisions from #184
 * (#187). The user's manual expand/collapse is remembered in
 * `OBSERVATION_CONTRIBUTIONS_TOGGLE` so re-renders preserve their choice
 * within the same session.
 */
function renderObservationContributions(uuid, neuronType) {
  const panel = el.observationContributionsPanel;
  if (!panel) return;
  if (!SNAPSHOT) {
    panel.innerHTML = "";
    return;
  }

  // Restrict to output neurons (Issue #186).
  if (neuronType !== "output") {
    panel.innerHTML = "";
    return;
  }

  const cacheKey = `topInputs:${uuid}`;
  let cached = TOP_INPUT_CACHE.get(cacheKey);
  if (!cached) {
    cached = computeTopContributingInputs(uuid, {
      maxDepth: 7,
      maxWork: 1600,
      maxInboundPerNode: 40,
    });
    TOP_INPUT_CACHE.set(cacheKey, cached);
  }

  panel.innerHTML = buildObservationContributionsHtml({
    uuid,
    neuronType,
    inputs: cached.inputs ?? [],
    getAlias,
    getGroup: getInputGroup,
    getDescription: getInputDescription,
    isPhone: isNarrowMobile(),
    userToggle: OBSERVATION_CONTRIBUTIONS_TOGGLE.get(uuid) ?? null,
    topN: getObservationTopN(),
  });

  // Track user toggles so the panel state survives re-renders in the same
  // session (#187).
  const details = panel.querySelector(
    `details.observationContributionsDetails[data-uuid="${cssEscape(uuid)}"]`,
  );
  if (details) {
    details.addEventListener("toggle", () => {
      OBSERVATION_CONTRIBUTIONS_TOGGLE.set(
        uuid,
        details.open ? "open" : "closed",
      );
    });
  }

  // Wire the top-N stepper (#243). The stepper lives inside the <summary>;
  // we stop click/keydown propagation so interacting with it doesn't toggle
  // the surrounding <details>.
  const stepper = panel.querySelector(
    `input[data-role="observation-topn-stepper"]`,
  );
  if (stepper) {
    const stop = (ev) => ev.stopPropagation();
    stepper.addEventListener("click", stop);
    stepper.addEventListener("keydown", stop);
    stepper.addEventListener("input", () => {
      setObservationTopN(stepper.value);
      _observationTopNDebounce.call(uuid, neuronType);
    });
    // On blur, normalise the visible value to the clamped/persisted value so
    // out-of-range input collapses immediately rather than waiting for the
    // next render.
    stepper.addEventListener("blur", () => {
      stepper.value = String(getObservationTopN());
    });
  }
}

/**
 * Minimal CSS attribute selector escaper for UUIDs that may include
 * characters with special meaning in selectors. UUIDs in this project are
 * conservative (`input-N`, hex chunks), but escape defensively for safety.
 */
function cssEscape(value) {
  if (typeof globalThis.CSS?.escape === "function") {
    return globalThis.CSS.escape(value);
  }
  return String(value).replace(/(["\\\]])/g, "\\$1");
}

function renderImpactDiagnosticsPanel(uuid, neuronType) {
  if (!el.impactDiagnosticsPanel) return;

  // Only meaningful for non-input neurons (they have outgoing synapses).
  if (uuid.startsWith("input-") || neuronType === "input") {
    el.impactDiagnosticsPanel.innerHTML = "";
    return;
  }

  const outs = synapses.filter((s) => s.fromUuid === uuid);
  if (outs.length === 0) {
    el.impactDiagnosticsPanel.innerHTML = "";
    return;
  }

  const title = "Impact proxy working → downstream";
  const note =
    "Each term shows why the gradient-style proxy thinks this neuron can influence outputs: " +
    "term = sens(to) × |w| × mean|d(to squash)|. Non-smooth squashes are flagged.";

  const terms = computeOutgoingProxyTerms({
    fromUuid: uuid,
    synapses,
    neuronsByUuid,
    proxySens: DIAG_PROXY,
    squashStats: DIAG_SQUASH,
  });

  const rows = terms.slice(0, 8).map((t) => {
    const toLabel = truncateNeuronName(t.toUuid);
    const w = formatSig(t.weight, 3);
    const d = t.toMeanAbsD != null ? formatSig(t.toMeanAbsD, 3) : "N/A";
    const sens = t.toSens != null ? formatSig(t.toSens, 3) : "N/A";
    const term = t.term != null ? formatSig(t.term, 3) : "N/A";
    const warn = t.toNonSmooth ? ` ⚠ ${t.toSquash}` : t.toSquash;

    return `
      <div class="impactBreakdownRow">
        <div class="impactBreakdownOut" title="${
      escapeHtml(fullNeuronName(t.toUuid))
    }">${escapeHtml(toLabel)}</div>
        <div class="impactBreakdownStats">
          <span class="stat" title="Downstream squash">${
      escapeHtml(warn)
    }</span>
          <span class="stat" title="Weight">w: ${escapeHtml(w)}</span>
          <span class="stat" title="mean |d(squash)| at downstream node">${
      escapeHtml("d: " + d)
    }</span>
          <span class="stat" title="Downstream sensitivity">${
      escapeHtml("sens: " + sens)
    }</span>
          <span class="stat" title="term = sens × |w| × d">${
      escapeHtml("term: " + term)
    }</span>
        </div>
      </div>
    `;
  }).join("");

  el.impactDiagnosticsPanel.innerHTML = `
    <div class="impactBreakdownHeader">
      <div class="impactBreakdownTitle">${escapeHtml(title)}</div>
    </div>
    <div class="impactBreakdownNote">${escapeHtml(note)}</div>
    <div class="impactBreakdownList">${rows}</div>
  `;
}

function renderImpactBreakdown(uuid, neuronImpact) {
  if (!el.impactBreakdown) return;

  const inbound = getInboundSynapses(uuid);
  if (inbound.length === 0 || neuronImpact == null) {
    el.impactBreakdown.innerHTML = "";
    return;
  }

  const toNeuron = neuronsByUuid.get(uuid) ?? null;
  const toStats = getNeuronStats(uuid);
  const recordedActMax = typeof toStats?.activationMax === "number"
    ? Math.max(
      Math.abs(toStats.activationMax),
      typeof toStats?.activationMin === "number"
        ? Math.abs(toStats.activationMin)
        : 0,
    )
    : null;
  const allocation = computeInboundSynapseImpactAllocation({
    toUuid: uuid,
    neuronImpact: neuronImpact ?? null,
    inboundSynapses: inbound.map((s) => ({
      fromUuid: s.fromUuid,
      toUuid: s.toUuid,
      weight: s.weight,
      meanContribution: getMeanContribution(s.fromUuid, s.toUuid),
      // Issue #513 — per-observation series for selection-squash attribution.
      contributions: getSynapseContributions(s.fromUuid, s.toUuid, s.weight),
    })),
    toNeuronSquash: toNeuron?.squash ?? null,
    recordedActivationMax: recordedActMax,
    // Issue #273 — surface effectiveShare + gateMaskedFraction on each row.
    consumerContract: CONSUMER_CONTRACT,
  });

  lastInboundAllocation = allocation;
  lastInboundToUuid = uuid;
  lastInboundPage = 0;

  const title = "Impact ← inbound synapses";
  const note =
    "Heuristic allocation of this neuron's impact back across its inbound synapses. " +
    "score = |meanContribution| (fallback |weight|), then allocatedImpact = impact × score / Σ score.";

  const headerHtml = `
    <div class="impactBreakdownHeader">
      <div class="impactBreakdownTitle">${escapeHtml(title)}</div>
      <button class="impactBreakdownBtn" type="button" data-open-inbound="1" title="Inspect full calculation">Inspect</button>
    </div>
    <div class="impactBreakdownNote">${escapeHtml(note)}</div>
  `;

  const top = allocation.synapses.slice(0, 5);
  const rows = top.map((r) => {
    const fromLabel = truncateNeuronName(r.fromUuid);
    const alloc = r.allocatedImpact != null
      ? formatSig(r.allocatedImpact, 3)
      : "N/A";
    const sharePct = formatSig(r.share * 100, 3) + "%";
    const mc = r.meanContribution != null
      ? formatSig(r.meanContribution, 3)
      : "N/A";
    return `
      <div class="impactBreakdownRow">
        <div class="impactBreakdownOut" title="${
      escapeHtml(fullNeuronName(r.fromUuid))
    }">${escapeHtml(fromLabel)}</div>
        <div class="impactBreakdownStats">
          <span class="stat" title="Allocated impact from this inbound synapse">${
      escapeHtml(alloc)
    }</span>
          <span class="stat" title="Share of this neuron's impact">${
      escapeHtml(sharePct)
    }</span>
          <span class="stat" title="Mean contribution (activation × weight)">${
      escapeHtml("c: " + mc)
    }</span>
        </div>
      </div>
    `;
  }).join("");

  el.impactBreakdown.innerHTML = headerHtml +
    `<div class="impactBreakdownList">${rows}</div>`;

  el.impactBreakdown.onclick = (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;
    const btn = target.closest(".impactBreakdownBtn");
    if (!btn) return;
    if (btn.getAttribute("data-open-inbound") === "1") openInboundModal();
  };
}

function openInboundModal() {
  if (!el.pathModal || !el.pathModalBody || !el.pathModalTitle) return;
  if (!lastInboundAllocation || !lastInboundToUuid) return;
  _modalTrigger = document.activeElement;
  lastInboundPage = 0;
  el.pathModal.classList.add("isOpen");
  el.pathModal.setAttribute("aria-hidden", "false");
  renderInboundModalPage();
  const panel = el.pathModal.querySelector(".modalPanel");
  if (panel) {
    const target = getInitialFocusTarget(panel);
    if (target) target.focus();
    _focusTrapCleanup = installFocusTrap(panel);
  }
}

function closePathModal() {
  if (!el.pathModal) return;
  el.pathModal.classList.remove("isOpen");
  el.pathModal.setAttribute("aria-hidden", "true");
  if (_focusTrapCleanup) {
    _focusTrapCleanup();
    _focusTrapCleanup = null;
  }
  if (_modalTrigger && typeof _modalTrigger.focus === "function") {
    _modalTrigger.focus();
    _modalTrigger = null;
  }
}

function renderInboundModalPage() {
  if (!el.pathModalBody || !el.pathModalTitle || !el.pathModalMore) return;
  if (!lastInboundAllocation || !lastInboundToUuid) return;

  const rows = lastInboundAllocation.synapses;
  const total = rows.length;
  const shown = Math.min(total, (lastInboundPage + 1) * INBOUND_PAGE_SIZE);

  el.pathModalTitle.textContent = `Inbound impact allocation for ${
    truncateUuid(lastInboundToUuid)
  }`;

  const impact = lastInboundAllocation.neuronImpact;
  const totalScore = lastInboundAllocation.totalScore;

  const header = `
    <dl class="modalKvp">
      <dt>Current neuron</dt>
      <dd>${escapeHtml(lastInboundToUuid)}</dd>
      <dt>Neuron impact</dt>
      <dd>${escapeHtml(impact != null ? formatSig(impact, 6) : "N/A")}</dd>
      <dt>Inbound synapses</dt>
      <dd>${escapeHtml(String(total))}</dd>
      <dt>Σ score</dt>
      <dd>${escapeHtml(formatSig(totalScore, 6))}</dd>
      <dt>Score definition</dt>
      <dd>${escapeHtml("|meanContribution| (fallback |weight|)")}</dd>
      <dt>Allocation</dt>
      <dd><span class="pathEquation">allocatedImpact = impact × score / Σ score</span></dd>
    </dl>
  `;

  const items = rows.slice(0, shown).map((r) => {
    const score = r.score ?? 0;
    const share = r.share ?? 0;
    const alloc = r.allocatedImpact;
    const mc = r.meanContribution;
    const eq = totalScore > 0 && impact != null
      ? `${formatSig(impact, 6)} × ${formatSig(score, 6)} / ${
        formatSig(totalScore, 6)
      } = ${formatSig(alloc ?? 0, 6)}`
      : "N/A";

    return `
      <details class="pathItem">
        <summary>
          <span class="pathSummaryPath">${
      escapeHtml(`${truncateUuid(r.fromUuid)} → ${truncateUuid(r.toUuid)}`)
    }</span>
          <span class="pathSummaryScore">${
      escapeHtml(formatSig(alloc ?? 0, 6))
    }</span>
        </summary>
        <div class="pathDetails">
          <div>Weight: <span class="pathEquation">${
      escapeHtml(formatSig(r.weight, 6))
    }</span></div>
          <div>Mean contribution: <span class="pathEquation">${
      escapeHtml(mc != null ? formatSig(mc, 6) : "N/A")
    }</span></div>
          <div>Score: <span class="pathEquation">${
      escapeHtml(formatSig(score, 6))
    }</span></div>
          <div>Share: <span class="pathEquation">${
      escapeHtml(formatSig(share, 6))
    } (=${escapeHtml(formatSig(share * 100, 4))}%)</span></div>
          <div>Allocated impact: <span class="pathEquation">${
      escapeHtml(eq)
    }</span></div>
        </div>
      </details>
    `;
  }).join("");

  el.pathModalBody.innerHTML = header + `<div class="pathList">${items}</div>`;

  if (shown >= total) {
    el.pathModalMore.style.display = "none";
  } else {
    el.pathModalMore.style.display = "";
    el.pathModalMore.textContent = `Show more (${shown}/${total})`;
  }
}

// Modal wiring (close / backdrop / pagination). These are no-ops if the modal
// isn't present (e.g., older HTML).
if (el.pathModalBackdrop) {
  el.pathModalBackdrop.onclick = () => closePathModal();
}
if (el.pathModalClose) {
  el.pathModalClose.onclick = () => closePathModal();
}
if (el.pathModalMore) {
  el.pathModalMore.onclick = () => {
    lastInboundPage += 1;
    renderInboundModalPage();
  };
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closePathModal();
});

// Observations modal wiring (close / backdrop / Esc).
if (el.obsBtn) {
  el.obsBtn.onclick = () => openObsModal();
}
if (el.obsModalBackdrop) {
  el.obsModalBackdrop.onclick = () => closeObsModal();
}
if (el.obsModalClose) {
  el.obsModalClose.onclick = () => closeObsModal();
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeObsModal();
});

function getInboundSynapses(toUuid) {
  return inboundByTo.get(toUuid) ?? [];
}

function renderSynapseList(toUuid, { animate = false } = {}) {
  const inbound = getInboundSynapses(toUuid);
  el.synapseCount.textContent = inbound.length;

  if (inbound.length === 0) {
    el.synapseListContainer.innerHTML = `
      <div class="emptyState">
        ${
      toUuid.startsWith("input-")
        ? "This is an observation (no inbound synapses)"
        : "No inbound synapses found"
    }
      </div>
    `;
    return;
  }

  const currentImpact = getNeuronImpact(toUuid);
  const toNeuron = neuronsByUuid.get(toUuid) ?? null;
  const toStats = getNeuronStats(toUuid);
  const recordedActMax = typeof toStats?.activationMax === "number"
    ? Math.max(
      Math.abs(toStats.activationMax),
      typeof toStats?.activationMin === "number"
        ? Math.abs(toStats.activationMin)
        : 0,
    )
    : null;
  const allocation = computeInboundSynapseImpactAllocation({
    toUuid,
    neuronImpact: currentImpact ?? null,
    inboundSynapses: inbound.map((s) => ({
      fromUuid: s.fromUuid,
      toUuid: s.toUuid,
      weight: s.weight,
      meanContribution: getMeanContribution(s.fromUuid, s.toUuid),
      // Issue #513 — per-observation series for selection-squash attribution.
      contributions: getSynapseContributions(s.fromUuid, s.toUuid, s.weight),
    })),
    toNeuronSquash: toNeuron?.squash ?? null,
    recordedActivationMax: recordedActMax,
    // Issue #273 — surface effectiveShare + gateMaskedFraction on each row.
    consumerContract: CONSUMER_CONTRACT,
  });
  const allocByFrom = new Map(allocation.synapses.map((r) => [r.fromUuid, r]));

  const enriched = inbound.map((syn) => {
    const impact = getNeuronImpact(syn.fromUuid);
    const mse = getMSE(syn.fromUuid);
    const contrib = getMeanContribution(syn.fromUuid, syn.toUuid);
    const alias = getAlias(syn.fromUuid);
    const isInput = syn.fromUuid.startsWith("input-");
    const allocRow = allocByFrom.get(syn.fromUuid);
    const allocImpact = allocRow?.allocatedImpact ?? null;
    const allocShare = allocRow?.share ?? null;
    // Issue #273 — surface gate-aware values to the row renderer.
    const effectiveShare = typeof allocRow?.effectiveShare === "number"
      ? allocRow.effectiveShare
      : null;
    const gateMaskedFraction = typeof allocRow?.gateMaskedFraction === "number"
      ? allocRow.gateMaskedFraction
      : 0;
    return {
      ...syn,
      impact,
      mse,
      contrib,
      alias,
      isInput,
      allocImpact,
      allocShare,
      effectiveShare,
      gateMaskedFraction,
    };
  });

  const sortKey = el.synapseSort.value;
  enriched.sort((a, b) => {
    switch (sortKey) {
      case "allocImpact":
        return (b.allocImpact ?? 0) - (a.allocImpact ?? 0);
      case "allocImpactAsc":
        return (a.allocImpact ?? 0) - (b.allocImpact ?? 0);
      case "weight":
        return b.weight - a.weight;
      case "absWeight":
        return Math.abs(b.weight) - Math.abs(a.weight);
      case "absContribution":
        return Math.abs(b.contrib ?? 0) - Math.abs(a.contrib ?? 0);
      case "impact":
        return (b.impact ?? 0) - (a.impact ?? 0);
      case "impactAsc":
        return (a.impact ?? 0) - (b.impact ?? 0);
      case "mse":
        return (b.mse ?? 0) - (a.mse ?? 0);
      default:
        return Math.abs(b.weight) - Math.abs(a.weight);
    }
  });

  // Apply filters.
  const filtered = enriched.filter((syn) => {
    if (inboundMinAllocImpact > 0) {
      const ai = syn.allocImpact ?? 0;
      if (ai < inboundMinAllocImpact) return false;
    }
    return true;
  });

  // Apply top-K / paging (Show more).
  const totalFiltered = filtered.length;
  let showCount = totalFiltered;
  if (inboundRenderLimit && inboundRenderLimit > 0) {
    showCount = Math.min(totalFiltered, inboundRenderLimit);
  }
  const visible = filtered.slice(0, showCount);

  // Update badge so it's clear when filters are hiding most synapses.
  if (el.synapseCount) {
    el.synapseCount.textContent = inbound.length === totalFiltered
      ? String(inbound.length)
      : `${totalFiltered}/${inbound.length}`;
  }

  el.synapseListContainer.innerHTML = "";

  // Compute maximum absolute weight for colour normalisation.
  const maxAbsWeight = visible.reduce(
    (mx, s) => Math.max(mx, Math.abs(s.weight ?? 0)),
    1,
  );

  // Colour legend for synapse weight scale (#105, #244).
  // Inline single-line layout on desktop — no <details>/<summary> collapse;
  // the swatches are always visible so users do not have to click to reveal.
  const legend = document.createElement("div");
  legend.className = "synapseLegend";
  legend.title =
    "Synapse weight colour scale: red for negative, blue for positive, grey near zero (signed weight).";
  legend.innerHTML = `<div class="legendItems">
      <span><span class="legendSwatch" style="background:${
    synapseWeightColourCss(-maxAbsWeight, maxAbsWeight)
  }"></span>Strong −</span>
      <span><span class="legendSwatch" style="background:${
    synapseWeightColourCss(-maxAbsWeight * 0.3, maxAbsWeight)
  }"></span>Weak −</span>
      <span><span class="legendSwatch" style="background:${
    synapseWeightColourCss(0, maxAbsWeight)
  }"></span>≈ 0</span>
      <span><span class="legendSwatch" style="background:${
    synapseWeightColourCss(maxAbsWeight * 0.3, maxAbsWeight)
  }"></span>Weak +</span>
      <span><span class="legendSwatch" style="background:${
    synapseWeightColourCss(maxAbsWeight, maxAbsWeight)
  }"></span>Strong +</span>
    </div>`;
  el.synapseListContainer.appendChild(legend);

  visible.forEach((syn, rowIndex) => {
    const row = document.createElement("div");
    row.className = "synapseRow";

    // Weight-strength colour indicator: left border + inline chip (#105).
    const weightCss = synapseWeightColourCss(syn.weight, maxAbsWeight);
    row.style.borderLeftWidth = "4px";
    row.style.borderLeftStyle = "solid";
    row.style.borderLeftColor = weightCss;

    // Staggered fade-in animation (#104).
    if (animate && !prefersReducedMotion()) {
      row.classList.add("fadeIn");
      const delay = synapseStaggerDelay(rowIndex, visible.length);
      if (delay > 0) row.style.animationDelay = `${delay}ms`;
    }
    const selected = (DISCOVERY_CANDIDATES ?? []).find((c) =>
      c?.key === selectedCandidateKey
    );
    if (
      selected &&
      String(selected.type ?? "").toLowerCase() ===
        "split_synapse_insert_neuron" &&
      selected.fromUuid === syn.fromUuid &&
      selected.toUuid === syn.toUuid
    ) {
      // Candidate overlay: highlight the original edge to be replaced.
      row.classList.add("candidateReplaceEdge");
    }
    if (trace.includes(syn.fromUuid)) {
      row.classList.add("inTrace");
    }
    if (
      syn.impact != null && syn.impact < IMPACT_SUSPICIOUS_THRESHOLD &&
      syn.impact >= 0
    ) {
      row.classList.add("suspicious");
    }

    const fromNeuron = neuronsByUuid.get(syn.fromUuid);
    const fromType = fromNeuron?.type ?? (syn.isInput ? "input" : "hidden");

    let nameHtml;
    if (syn.alias) {
      nameHtml = `
        <span class="neuronAlias" title="${
        escapeHtml(getInputDescription(syn.fromUuid) ?? "")
      }">${escapeHtml(syn.alias)}</span>
        <span class="neuronUuidSmall">${escapeHtml(syn.fromUuid)}</span>
      `;
    } else {
      nameHtml = `<span class="neuronUuid">${escapeHtml(syn.fromUuid)}</span>`;
    }

    const statsHtml = [];
    statsHtml.push(
      `<span class="stat ${
        syn.weight >= 0 ? "positive" : "negative"
      }" title="Weight: strength of connection"><span class="weightChip" style="background:${weightCss}"></span>w: ${
        formatNumber(syn.weight)
      }</span>`,
    );

    if (syn.impact != null) {
      const impactClass = getImpactClass(syn.impact);
      const impactNote = syn.impact < IMPACT_SUSPICIOUS_THRESHOLD ? " ⚠️" : "";
      const tooltip = syn.impact < IMPACT_SUSPICIOUS_THRESHOLD
        ? "Source impact < 1e-8: suspiciously low - should be prunable"
        : "Source neuron's impact (global), not additive across inbound synapses";
      statsHtml.push(
        `<span class="stat ${impactClass}" title="${tooltip}">src imp: ${
          formatSig(syn.impact, 3)
        }${impactNote}</span>`,
      );
    }

    if (syn.allocImpact != null) {
      // Issue #273 — when the consumer contract says this input is masked by
      // a downstream min(...) gate in some samples, the "alloc imp" already
      // reflects only the effective (post-gate) influence. Annotate with a
      // pre-gate badge so users can see the masked fraction.
      const gateMasked = Number(syn.gateMaskedFraction) || 0;
      const isGated = gateMasked > 0;
      const primaryTooltip = isGated
        ? "Effective allocated impact after downstream gating (sums to current neuron's impact)"
        : "Allocated impact into the current neuron (sums to current neuron's impact)";
      statsHtml.push(
        `<span class="stat" title="${escapeHtml(primaryTooltip)}">alloc imp: ${
          formatSig(syn.allocImpact, 3)
        }</span>`,
      );
      if (isGated) {
        // Estimate the pre-gate allocated impact: scaled back by the active
        // fraction. We don't have a guaranteed pre-gate field on the row, so
        // reconstruct it from the masked fraction.
        const active = 1 - gateMasked;
        const preGate = active > 0 ? syn.allocImpact / active : syn.allocImpact;
        const maskedPct = `${(gateMasked * 100).toFixed(1)}%`;
        const tip =
          `Pre-gate share — masked by downstream min(...) gate in ${maskedPct} of samples`;
        statsHtml.push(
          `<span class="stat preGateBadge" data-pre-gate="true" title="${
            escapeHtml(tip)
          }">pre-gate: ${escapeHtml(formatSig(preGate, 3))}</span>`,
        );
      }
    }

    if (syn.contrib != null) {
      statsHtml.push(
        `<span class="stat" title="Contribution: activation × weight">c: ${
          formatSig(syn.contrib, 3)
        }</span>`,
      );
    }

    if (!syn.isInput && syn.mse != null) {
      const errorClass = syn.mse > MSE_ERROR_THRESHOLD ? "error" : "";
      statsHtml.push(
        `<span class="stat ${errorClass}" title="Mean Squared Error - matches production">mse: ${
          formatSig(syn.mse, 3)
        }</span>`,
      );
    }

    row.innerHTML = `
      ${buildSynapseFromCellHtml(nameHtml, fromType)}
      <div class="synapseStats">${statsHtml.join("")}</div>
      <div class="synapseNav">→</div>
    `;

    row.onclick = () => navigateTo(syn.fromUuid);
    el.synapseListContainer.appendChild(row);
  });

  if (showCount < totalFiltered) {
    const wrap = document.createElement("div");
    wrap.className = "showMoreRow";
    const btn = document.createElement("button");
    btn.className = "button buttonSmall";
    btn.type = "button";
    btn.textContent = `Show more (${showCount}/${totalFiltered})`;
    btn.onclick = () => {
      const step = inboundTopK && inboundTopK > 0 ? inboundTopK : 200;
      inboundRenderLimit = (inboundRenderLimit || showCount) + step;
      renderSynapseList(toUuid, { animate: true });
    };
    wrap.appendChild(btn);
    el.synapseListContainer.appendChild(wrap);
  }
}

function formatNumber(n, decimals = 4) {
  if (n == null || typeof n !== "number") return "N/A";
  if (!isFinite(n)) return String(n);
  return formatDecimal(n, decimals);
}

function formatSig(n, sigFigs = 3) {
  if (n == null || typeof n !== "number") return "N/A";
  if (!isFinite(n)) return String(n);
  if (n === 0) return "0";

  const absN = Math.abs(n);
  if (absN < 0.001 || absN >= 10000) {
    return n.toExponential(sigFigs - 1);
  }
  return Number(n.toPrecision(sigFigs)).toString();
}

// escapeHtml imported from shared/ui_helpers.js (Issue #125).

/**
 * Format an observation reference for display.
 *
 * Issue #62: When obsIndices contains string identifiers (e.g. "first-one"),
 * showing "obs_index=second-one" was confusing. This helper formats the
 * reference appropriately based on whether it's a numeric index or string ID.
 *
 * @param {number|string|null} obsRef - The observation index or identifier.
 * @returns {string} - Formatted string like "obs #42" or "obs 'my-id'".
 */
function formatObsRef(obsRef) {
  if (obsRef == null) return "";
  if (typeof obsRef === "number") {
    return `obs #${obsRef}`;
  }
  // String identifier - quote it to make clear it's a literal ID.
  return `obs '${obsRef}'`;
}

// ============================================================================
// Tooltips (mobile)
// ============================================================================

function initTouchTooltips() {
  // iOS Safari/PWA does not reliably show `title` tooltips on tap.
  // Provide tap + press-and-hold tooltips on touch devices, without stealing
  // normal taps for unrelated controls.
  const isTouch = (() => {
    try {
      return (navigator.maxTouchPoints ?? 0) > 0 ||
        window.matchMedia?.("(hover: none)")?.matches === true;
    } catch (_e) {
      return false;
    }
  })();

  if (!isTouch) return;

  let tooltipEl = document.getElementById("touchTooltip");
  if (!tooltipEl) {
    tooltipEl = document.createElement("div");
    tooltipEl.id = "touchTooltip";
    tooltipEl.className = "touchTooltip";
    tooltipEl.setAttribute("role", "dialog");
    tooltipEl.setAttribute("aria-live", "polite");
    tooltipEl.innerHTML = `
      <div class="touchTooltipHeader">
        <div class="touchTooltipTitle">Tip</div>
        <button type="button" class="touchTooltipClose">Close</button>
      </div>
      <div class="touchTooltipBody"></div>
    `;
    document.body.appendChild(tooltipEl);

    tooltipEl.querySelector(".touchTooltipClose")?.addEventListener(
      "click",
      () => hideTouchTooltip(),
    );
  }

  const bodyEl = tooltipEl.querySelector(".touchTooltipBody");

  function showTouchTooltip(text) {
    if (!tooltipEl || !bodyEl) return;
    const msg = String(text ?? "").trim();
    if (!msg) return;
    bodyEl.textContent = msg;
    tooltipEl.classList.add("isOpen");
  }

  function hideTouchTooltip() {
    tooltipEl?.classList.remove("isOpen");
  }

  // Press-and-hold detection.
  let pressTimer = null;
  let shownForTarget = null;
  let suppressClickUntil = 0;

  function findTooltipTarget(startEl) {
    let n = startEl;
    while (n && n !== document.body) {
      // Only treat known tooltip affordances as tooltip targets. Many controls
      // (buttons, inputs) have titles but still need to behave normally on tap.
      const isKnownTooltipEl = n.classList?.contains("hasTooltip") ||
        n.classList?.contains("stat") ||
        n.classList?.contains("neuronAlias") ||
        n.classList?.contains("aliasName");

      if (isKnownTooltipEl && n?.getAttribute && n.hasAttribute("title")) {
        const t = n.getAttribute("title");
        if (t && t.trim().length > 0) return n;
      }
      n = n.parentElement;
    }
    return null;
  }

  document.addEventListener(
    "touchstart",
    (e) => {
      if (pressTimer) clearTimeout(pressTimer);

      const target = findTooltipTarget(e.target);
      if (!target) return;

      // Long-press shows the tooltip; short tap continues normal behaviour.
      pressTimer = setTimeout(() => {
        shownForTarget = target;
        suppressClickUntil = Date.now() + 650;
        showTouchTooltip(target.getAttribute("title"));
      }, 450);
    },
    { passive: true, capture: true },
  );

  document.addEventListener(
    "touchmove",
    () => {
      if (pressTimer) clearTimeout(pressTimer);
      pressTimer = null;
    },
    { passive: true, capture: true },
  );

  document.addEventListener(
    "touchend",
    () => {
      if (pressTimer) clearTimeout(pressTimer);
      pressTimer = null;
    },
    { passive: true, capture: true },
  );

  // iPhone Safari can be inconsistent about long-press and `title`. Make tap the
  // primary way to open tooltips for stat chips / labelled properties.
  document.addEventListener(
    "click",
    (e) => {
      const target = findTooltipTarget(e.target);
      if (!target) return;

      // If a long-press just opened a tooltip, iOS will often fire a follow-up
      // click on release. During the suppression window, do not toggle/close the
      // tooltip; just swallow the click to prevent accidental actions.
      if (Date.now() < suppressClickUntil) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // Toggle: tapping the same target closes the tooltip.
      if (
        shownForTarget && target === shownForTarget &&
        tooltipEl?.classList.contains("isOpen")
      ) {
        hideTouchTooltip();
      } else {
        shownForTarget = target;
        showTouchTooltip(target.getAttribute("title"));
      }

      // Don't let the click bubble and trigger row navigation underneath.
      e.preventDefault();
      e.stopPropagation();
    },
    { capture: true },
  );

  // Tap anywhere outside the tooltip to close it.
  document.addEventListener(
    "touchstart",
    (e) => {
      if (!tooltipEl?.classList.contains("isOpen")) return;
      if (tooltipEl.contains(e.target)) return;
      // If the touch is on a known tooltip target, let the tap-to-toggle handler
      // manage it. Otherwise, we'd close on touchstart then re-open on click.
      if (findTooltipTarget(e.target)) return;
      hideTouchTooltip();
    },
    { passive: true },
  );

  // Some iOS flows fire `click` without a preceding touchstart (e.g., assistive
  // tech). Support outside-click close as well.
  document.addEventListener(
    "click",
    (e) => {
      if (!tooltipEl?.classList.contains("isOpen")) return;
      if (tooltipEl.contains(e.target)) return;
      // If the click was on a known tooltip target, let the tap-to-toggle handler
      // manage it. Both listeners run on `document` in the capture phase, so we
      // must explicitly avoid immediately closing a tooltip we just opened.
      if (findTooltipTarget(e.target)) return;
      hideTouchTooltip();
    },
    { capture: true },
  );
}

// ============================================================================
// Tabs: Details / Issues / Candidates
// ============================================================================

function applyNeuronTabState() {
  const tab = currentNeuronTab;

  const cfg = [
    ["details", el.neuronTabDetails, el.neuronTabPanelDetails],
    ["issues", el.neuronTabIssues, el.neuronTabPanelIssues],
    ["candidates", el.neuronTabCandidates, el.neuronTabPanelCandidates],
  ];

  for (const [name, btn, panel] of cfg) {
    if (btn) {
      const active = name === tab;
      btn.classList.toggle("isActive", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    }
    if (panel) {
      panel.classList.toggle("isActive", name === tab);
    }
  }

  // Sync mobile bottom tab bar (#108).
  const panelMap = {
    details: "neuronTabPanelDetails",
    issues: "neuronTabPanelIssues",
    candidates: "neuronTabPanelCandidates",
  };
  document.querySelectorAll(".mobileTabBtn").forEach((btn) => {
    btn.classList.toggle(
      "isActive",
      btn.getAttribute("data-tab") === panelMap[tab],
    );
  });
}

function setNeuronTab(tab) {
  const t = String(tab ?? "").toLowerCase();
  if (t !== "details" && t !== "issues" && t !== "candidates") return;
  currentNeuronTab = t;
  applyNeuronTabState();
}

if (el.neuronTabDetails) {
  el.neuronTabDetails.onclick = () => setNeuronTab("details");
}
if (el.neuronTabIssues) {
  el.neuronTabIssues.onclick = () => setNeuronTab("issues");
}
if (el.neuronTabCandidates) {
  el.neuronTabCandidates.onclick = () => setNeuronTab("candidates");
}

// ============================================================================
// Tablet: synapse panel toggle (#108)
// ============================================================================

if (el.synapsePanelToggle) {
  el.synapsePanelToggle.addEventListener("click", () => {
    const list = document.querySelector(".synapseList");
    if (list) list.classList.toggle("isPanelOpen");
  });
}

// ============================================================================
// Inbound filters: inline ↔ collapsed popover layout (#245)
// ============================================================================

/**
 * Set the layout mode on the synapse header. Mirrors the popover state via
 * the `isOpen` class on the filter panel so CSS can show/hide accordingly.
 */
function setFiltersMode(mode) {
  const header = el.synapseHeader;
  if (!header) return;
  const current = header.getAttribute("data-filters-mode");
  if (current === mode) return;
  header.setAttribute("data-filters-mode", mode);
  // Switching back to inline closes any open popover and resets aria.
  if (mode === "inline" && el.synapseFilterPanel) {
    el.synapseFilterPanel.classList.remove("isOpen");
    if (el.synapseFiltersToggle) {
      el.synapseFiltersToggle.setAttribute("aria-expanded", "false");
    }
  }
}

/**
 * Measure whether the inline controls fit in the available panel width and
 * toggle `data-filters-mode` accordingly. Falls back to the MOBILE_MAX
 * heuristic when the controls width cannot be measured (e.g. during the
 * initial 0×0 layout pass).
 */
function syncFiltersModeFromMeasurement() {
  const header = el.synapseHeader;
  const tools = el.synapseTools;
  if (!header) return;
  const panelWidth = header.getBoundingClientRect().width;
  if (!tools) {
    setFiltersMode(decideFiltersModeByWidth(panelWidth));
    return;
  }
  // Measure the natural width the inline controls need by temporarily
  // forcing inline mode — scrollWidth then reflects the un-collapsed size.
  const previousMode = header.getAttribute("data-filters-mode") || "inline";
  if (previousMode !== "inline") {
    header.setAttribute("data-filters-mode", "inline");
  }
  const controlsWidth = tools.scrollWidth;
  // Heading + sticky padding compete for the same row — subtract the heading
  // width from the panel so the comparison reflects what's actually available
  // to .synapseTools.
  const heading = header.querySelector("h2");
  const headingWidth = heading ? heading.getBoundingClientRect().width : 0;
  const available = Math.max(0, panelWidth - headingWidth - 24); // 24px gap+padding
  let mode = decideFiltersMode(available, controlsWidth);
  if (!Number.isFinite(controlsWidth) || controlsWidth <= 0) {
    mode = decideFiltersModeByWidth(panelWidth);
  }
  // Restore previous mode first so setFiltersMode's diff check works.
  if (previousMode !== "inline") {
    header.setAttribute("data-filters-mode", previousMode);
  }
  setFiltersMode(mode);
}

function closeFiltersPopover() {
  const panel = el.synapseFilterPanel;
  const toggle = el.synapseFiltersToggle;
  if (!panel || !toggle) return;
  panel.classList.remove("isOpen");
  toggle.setAttribute("aria-expanded", "false");
  if (_filterPopoverFocusCleanup) {
    _filterPopoverFocusCleanup();
    _filterPopoverFocusCleanup = null;
  }
  if (_filterPopoverKeydown) {
    document.removeEventListener("keydown", _filterPopoverKeydown);
    _filterPopoverKeydown = null;
  }
  if (_filterPopoverClickAway) {
    document.removeEventListener("mousedown", _filterPopoverClickAway);
    _filterPopoverClickAway = null;
  }
  // Return focus to the trigger (WCAG SC 2.4.3).
  try {
    toggle.focus();
  } catch (_e) { /* JSDOM stubs may not implement focus */ }
}

/** @type {(() => void)|null} */
let _filterPopoverFocusCleanup = null;
/** @type {((e: KeyboardEvent) => void)|null} */
let _filterPopoverKeydown = null;
/** @type {((e: MouseEvent) => void)|null} */
let _filterPopoverClickAway = null;

function openFiltersPopover() {
  const panel = el.synapseFilterPanel;
  const toggle = el.synapseFiltersToggle;
  if (!panel || !toggle) return;
  panel.classList.add("isOpen");
  toggle.setAttribute("aria-expanded", "true");
  // Focus the first input for keyboard users.
  const target = getInitialFocusTarget(panel);
  if (target && typeof target.focus === "function") {
    try {
      target.focus();
    } catch (_e) { /* ignore */ }
  }
  _filterPopoverFocusCleanup = installFocusTrap(panel);
  _filterPopoverKeydown = (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      closeFiltersPopover();
    }
  };
  document.addEventListener("keydown", _filterPopoverKeydown);
  _filterPopoverClickAway = (e) => {
    const target = e.target;
    if (!(target instanceof Node)) return;
    if (panel.contains(target) || toggle.contains(target)) return;
    closeFiltersPopover();
  };
  document.addEventListener("mousedown", _filterPopoverClickAway);
}

function initInlineFiltersLayout() {
  if (!el.synapseHeader) return;
  // Initial measurement after first layout pass.
  syncFiltersModeFromMeasurement();

  // Prefer ResizeObserver — it fires whenever the panel width changes for
  // any reason (window resize, side-panel collapse, font load, etc.).
  if (typeof ResizeObserver === "function") {
    try {
      const ro = new ResizeObserver(() => {
        syncFiltersModeFromMeasurement();
      });
      ro.observe(el.synapseHeader);
    } catch (_e) {
      // Fall through to the matchMedia fallback below.
    }
  }

  // Always also listen to MOBILE_MAX so the fallback still fires when
  // ResizeObserver is unavailable or throws.
  try {
    const mql = window.matchMedia?.("(max-width: 639px)");
    mql?.addEventListener?.("change", () => {
      syncFiltersModeFromMeasurement();
    });
  } catch (_e) { /* matchMedia unavailable */ }

  // Wire the Filters toggle button (only visible in collapsed mode).
  if (el.synapseFiltersToggle) {
    el.synapseFiltersToggle.addEventListener("click", () => {
      const panel = el.synapseFilterPanel;
      if (!panel) return;
      if (panel.classList.contains("isOpen")) {
        closeFiltersPopover();
      } else {
        openFiltersPopover();
      }
    });
  }
}

// ============================================================================
// Mobile: bottom tab bar (#108)
// ============================================================================

{
  const tabMap = {
    neuronTabPanelDetails: "details",
    neuronTabPanelIssues: "issues",
    neuronTabPanelCandidates: "candidates",
  };
  document.querySelectorAll(".mobileTabBtn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tabKey = btn.getAttribute("data-tab");
      const tabName = tabMap[tabKey];
      if (tabName) setNeuronTab(tabName);
      // Update mobile tab active states.
      document.querySelectorAll(".mobileTabBtn").forEach((b) => {
        b.classList.toggle("isActive", b === btn);
      });
    });
  });
}

// ============================================================================
// Issues tab computations (cached on snapshot load)
// ============================================================================

// extractDiscoveryCandidates and normaliseCandidate imported from
// ./shared/discovery.js

// computeNonFiniteIssues and computeErrorConcentrationIssues imported from
// ./shared/diagnostics_scan.js

function computeInputIssues({ recording, inputCount, candidates }) {
  const neurons = recording?.neurons ?? {};

  // Near-constant inputs (std dev ~0).
  const constantInputs = [];
  for (let i = 0; i < (inputCount ?? 0); i++) {
    const uuid = `input-${i}`;
    const rec = neurons?.[uuid];
    const series = rec?.activation ?? rec?.value ?? null;
    if (!Array.isArray(series) || series.length === 0) continue;
    const s = summariseSeriesStats(series, { sampleSize: 1024 });
    if (s.n > 0 && s.std < 1e-6) {
      constantInputs.push({ uuid, std: s.std, mean: s.mean });
    }
  }

  // Candidate coverage for input-N nodes.
  const coverage = [];
  const counts = new Map();
  const helpful = new Map();
  const harmful = new Map();

  for (const c of (Array.isArray(candidates) ? candidates : [])) {
    const uuids = candidateReferencedInputUuids(c);
    const gain = typeof c.expectedScoreGain === "number"
      ? c.expectedScoreGain
      : null;
    for (const u of uuids) {
      counts.set(u, (counts.get(u) ?? 0) + 1);
      if (gain != null) {
        if (gain >= 0) helpful.set(u, (helpful.get(u) ?? 0) + 1);
        else harmful.set(u, (harmful.get(u) ?? 0) + 1);
      }
    }
  }

  for (let i = 0; i < (inputCount ?? 0); i++) {
    const uuid = `input-${i}`;
    coverage.push({
      uuid,
      count: counts.get(uuid) ?? 0,
      helpful: helpful.get(uuid) ?? 0,
      harmful: harmful.get(uuid) ?? 0,
    });
  }
  coverage.sort((a, b) => (b.count ?? 0) - (a.count ?? 0));

  return {
    constantInputs,
    correlatedPairs: null,
    _correlationParams: { recording, inputCount },
    candidateCoverage: coverage,
  };
}

/**
 * Lazily computes correlated input pairs on first access and caches the
 * result on DIAG_INPUTS.  This avoids the O(n²) correlation scan at
 * snapshot load time when the user may never open the diagnostics panel.
 */
function ensureCorrelatedPairs() {
  if (DIAG_INPUTS.correlatedPairs != null) return DIAG_INPUTS.correlatedPairs;
  const p = DIAG_INPUTS._correlationParams;
  if (!p) {
    DIAG_INPUTS.correlatedPairs = [];
    return DIAG_INPUTS.correlatedPairs;
  }
  DIAG_INPUTS.correlatedPairs = computeTopInputCorrelations({
    recording: p.recording,
    inputCount: p.inputCount,
    maxInputs: 80,
    sampleSize: 512,
    topK: 12,
  });
  return DIAG_INPUTS.correlatedPairs;
}

function candidateReferencedInputUuids(candidate) {
  /** @type {Set<string>} */
  const out = new Set();
  const re = /^input-\d+$/;

  function walk(x, depth) {
    if (depth > 4) return; // guard rails (candidates should be shallow)
    if (typeof x === "string") {
      const s = x.trim();
      if (re.test(s)) out.add(s);
      return;
    }
    if (!x || typeof x !== "object") return;
    if (Array.isArray(x)) {
      for (const v of x) walk(v, depth + 1);
      return;
    }
    for (const v of Object.values(x)) walk(v, depth + 1);
  }

  walk(candidate?.raw ?? candidate, 0);
  return Array.from(out);
}

// computeTopInputCorrelations imported from ./shared/correlation.js

// ============================================================================
// Issues tab UI
// ============================================================================

function renderIssuesPanel(currentUuid, neuronType) {
  if (!el.neuronTabPanelIssues) return;
  if (!SNAPSHOT) {
    el.neuronTabPanelIssues.innerHTML = "";
    return;
  }

  const isInput = currentUuid?.startsWith?.("input-") || neuronType === "input";

  const dead = DIAG_DEADZONES.get(currentUuid);
  const nonFinite = DIAG_NONFINITE.get(currentUuid);
  const notRecorded = DIAG_NOTRECORDED.get(currentUuid);
  const tail = DIAG_ERROR_TAIL.get(currentUuid);

  const pieces = [];

  pieces.push(`<div class="panelSectionTitle">Current neuron</div>`);
  pieces.push(`<div class="issueList">`);

  // Saturation & dead zones.
  if (!isInput && dead) {
    const dd = [];
    if (dead.fracClamped != null) {
      dd.push(`Clamp %: ${formatSig(dead.fracClamped * 100, 4)}%`);
    }
    if (dead.fracAtZero != null) {
      dd.push(`Dead zone %: ${formatSig(dead.fracAtZero * 100, 4)}%`);
    }
    if (dead.nonFiniteCount > 0) {
      dd.push(`Non-finite pre-acts: ${dead.nonFiniteCount}`);
    }
    if (dd.length > 0) {
      pieces.push(`
        <div class="issueRow">
          <div class="issueRowTitle">Saturation & dead zones</div>
          <div class="synapseStats">${
        dd.map((x) => `<span class="stat">${escapeHtml(x)}</span>`).join("")
      }</div>
        </div>
      `);
    }
  }

  // NaN/Infinity (genuine non-finite numbers) and not-recorded entries.
  //
  // Issue #507: recordings serialise through JSON, which cannot carry
  // NaN/Infinity — a non-finite number always becomes `null`. So a `null`
  // means the value was *not recorded* (the error-attribution walk did not
  // traverse this neuron on that observation), not that a non-finite number
  // was produced. We report the raw fact instead of the false "NaN/Infinity
  // (exploding gradients)" flag. Genuine non-finite numbers (should they ever
  // appear from a non-JSON source) are still surfaced separately.
  {
    // Genuinely non-finite numbers (real NaN/Infinity) — kept because they
    // would be a true fault. Structurally absent from JSON-sourced recordings.
    const nf = [];
    if (nonFinite?.activation?.count > 0) {
      const ref = formatObsRef(nonFinite.activation.firstObsIndex);
      nf.push(
        `NaN/Infinity activations: ${nonFinite.activation.count}${
          ref ? ` (first at ${ref})` : ""
        }`,
      );
    }
    if (nonFinite?.value?.count > 0) {
      const ref = formatObsRef(nonFinite.value.firstObsIndex);
      nf.push(
        `NaN/Infinity values: ${nonFinite.value.count}${
          ref ? ` (first at ${ref})` : ""
        }`,
      );
    }
    if (nonFinite?.errors?.count > 0) {
      const ref = formatObsRef(nonFinite.errors.firstObsIndex);
      nf.push(
        `NaN/Infinity errors: ${nonFinite.errors.count}${
          ref ? ` (first at ${ref})` : ""
        }`,
      );
    }
    if (nf.length) {
      pieces.push(`
      <div class="issueRow">
        <div class="issueRowTitle">NaN/Infinity (non-finite numbers)</div>
        <div class="synapseStats">${
        nf.map((x) => `<span class="stat error">${escapeHtml(x)}</span>`)
          .join("")
      }</div>
      </div>
    `);
    }

    // Not-recorded (absent) entries — the raw fact, no interpretation.
    const nr = [];
    const absentStat = (label, s) => {
      if (!s || !(s.absentCount > 0)) return;
      const ref = formatObsRef(s.firstAbsentObsIndex);
      const denom = s.length > 0 ? `/${s.length}` : "";
      nr.push(
        `${label} not recorded for ${s.absentCount}${denom} observations` +
          ` (error walk did not traverse)${ref ? ` (first at ${ref})` : ""}`,
      );
    };
    absentStat("activation", nonFinite?.activation);
    absentStat("value", nonFinite?.value);
    absentStat("errors", nonFinite?.errors);
    if (nr.length) {
      pieces.push(`
      <div class="issueRow">
        <div class="issueRowTitle">Not recorded</div>
        <div class="synapseStats">${
        nr.map((x) => `<span class="stat">${escapeHtml(x)}</span>`).join("")
      }</div>
      </div>
    `);
    }
  }

  // Values not recorded (issue #507): JSON `null` entries mean the error
  // attribution walk did not traverse this neuron at those observations. This
  // is a raw recording fact, not a non-finite/exploding-gradient problem, so we
  // present the counts verbatim with no interpretation or severity styling.
  if (notRecorded) {
    const dd = [];
    if (notRecorded.activation?.count > 0) {
      dd.push(
        `activation not recorded for ${notRecorded.activation.count}/${notRecorded.activation.length} observations`,
      );
    }
    if (notRecorded.value?.count > 0) {
      dd.push(
        `value not recorded for ${notRecorded.value.count}/${notRecorded.value.length} observations (error walk did not traverse)`,
      );
    }
    if (notRecorded.errors?.count > 0) {
      dd.push(
        `errors not recorded for ${notRecorded.errors.count}/${notRecorded.errors.rows} observations`,
      );
    }
    if (dd.length) {
      pieces.push(`
        <div class="issueRow">
          <div class="issueRowTitle">Values not recorded</div>
          <div class="synapseStats">${
        dd.map((x) => `<span class="stat">${escapeHtml(x)}</span>`).join("")
      }</div>
        </div>
      `);
    }
  }

  // Error concentration.
  if (!isInput && tail) {
    const top = tail.topK?.slice?.(0, 4) ?? [];
    const dd = [];
    if (top.length > 0) {
      dd.push(
        `Top obs share: ${formatSig((top[0]?.shareOfTotal ?? 0) * 100, 4)}%`,
      );
      dd.push(`Top-k share: ${formatSig((tail.topKShare ?? 0) * 100, 4)}%`);
      dd.push(`Top obs_index: ${top.map((t) => t.obsIndex).join(", ")}`);
    }
    pieces.push(`
      <div class="issueRow">
        <div class="issueRowTitle">Error concentration</div>
        <div class="synapseStats">${
      dd.length
        ? dd.map((x) => `<span class="stat">${escapeHtml(x)}</span>`).join("")
        : `<span class="stat">No per-observation error data</span>`
    }</div>
      </div>
    `);
  }

  pieces.push(`</div>`);

  // Global lists (quickly actionable).
  pieces.push(`<div class="panelSectionTitle">Flagged neurons</div>`);

  // Issue #68: Exclude constant inputs from flagged lists. A constant neuron
  // always outputs the same value, so flagging it for "dead zone" or "clamp"
  // is misleading—it's constant by design, not malfunctioning.
  const constantInputUuids = new Set(
    (DIAG_INPUTS?.constantInputs ?? []).map((x) => x.uuid).filter(Boolean),
  );

  // Genuine non-finite numbers only (total > 0). Absent-only neurons are
  // excluded here and surfaced in the "Not recorded" list below (issue #507).
  const nonFiniteUuids = Array.from(DIAG_NONFINITE.entries())
    .filter(([, d]) => (d?.total ?? 0) > 0)
    .sort((a, b) => (b[1]?.total ?? 0) - (a[1]?.total ?? 0))
    .slice(0, 10);

  const notRecordedUuids = Array.from(DIAG_NONFINITE.entries())
    .filter(([, d]) => (d?.absentTotal ?? 0) > 0)
    .sort((a, b) => (b[1]?.absentTotal ?? 0) - (a[1]?.absentTotal ?? 0))
    .slice(0, 10);

  const clampedUuids = Array.from(DIAG_DEADZONES.entries())
    .filter(([uuid, d]) => uuid && d && d.fracClamped != null)
    .filter(([uuid]) => !constantInputUuids.has(uuid))
    .sort((a, b) => (b[1].fracClamped ?? 0) - (a[1].fracClamped ?? 0))
    .slice(0, 10);

  const deadReluUuids = Array.from(DIAG_DEADZONES.entries())
    .filter(([uuid, d]) => uuid && d && d.fracAtZero != null)
    .filter(([uuid]) => !constantInputUuids.has(uuid))
    .sort((a, b) => (b[1].fracAtZero ?? 0) - (a[1].fracAtZero ?? 0))
    .slice(0, 10);

  const heavyTail = Array.from(DIAG_ERROR_TAIL.entries())
    .filter(([uuid]) => !constantInputUuids.has(uuid))
    .sort((a, b) =>
      (b[1]?.topK?.[0]?.shareOfTotal ?? 0) -
      (a[1]?.topK?.[0]?.shareOfTotal ?? 0)
    )
    .slice(0, 10);

  function renderJumpList(title, rows, renderStats) {
    if (!rows || rows.length === 0) return "";
    const html = rows.map(([uuid, data]) => {
      const stats = renderStats(data);
      return `
        <div class="issueRow" data-jump-uuid="${escapeHtml(uuid)}">
          <div class="issueRowTitle">${
        escapeHtml(truncateNeuronName(uuid))
      }</div>
          <div class="synapseStats">${stats}</div>
        </div>
      `;
    }).join("");
    return `<div class="panelSectionTitle">${
      escapeHtml(title)
    }</div><div class="issueList">${html}</div>`;
  }

  pieces.push(renderJumpList(
    "NaN/Infinity (top 10)",
    nonFiniteUuids,
    (d) => {
      const ref = formatObsRef(d.errors?.firstObsIndex);
      return `<span class="stat error">count: ${
        escapeHtml(String(d.total ?? 0))
      }</span>` +
        (ref ? `<span class="stat">first at ${escapeHtml(ref)}</span>` : "");
    },
  ));

  pieces.push(renderJumpList(
    "Not recorded (top 10)",
    notRecordedUuids,
    (d) => {
      const ref = formatObsRef(
        d.value?.firstAbsentObsIndex ?? d.errors?.firstAbsentObsIndex ??
          d.activation?.firstAbsentObsIndex,
      );
      return `<span class="stat">not recorded: ${
        escapeHtml(String(d.absentTotal ?? 0))
      }</span>` +
        (ref ? `<span class="stat">first at ${escapeHtml(ref)}</span>` : "");
    },
  ));

  pieces.push(renderJumpList(
    "Clamp % (top 10)",
    clampedUuids,
    (d) =>
      `<span class="stat">clamp: ${
        escapeHtml(formatSig((d.fracClamped ?? 0) * 100, 4))
      }%</span>`,
  ));

  pieces.push(renderJumpList(
    "Dead zone % (top 10)",
    deadReluUuids,
    (d) =>
      `<span class="stat">dead: ${
        escapeHtml(formatSig((d.fracAtZero ?? 0) * 100, 4))
      }%</span>`,
  ));

  pieces.push(renderJumpList(
    "Error heavy-tail (top 10)",
    heavyTail,
    (d) =>
      `<span class="stat">top1: ${
        escapeHtml(formatSig((d.topK?.[0]?.shareOfTotal ?? 0) * 100, 4))
      }%</span>` +
      `<span class="stat">top-k: ${
        escapeHtml(formatSig((d.topKShare ?? 0) * 100, 4))
      }%</span>`,
  ));

  // Input issues (redundancy).
  pieces.push(`<div class="panelSectionTitle">Inputs</div>`);
  const inputBits = [];
  if (DIAG_INPUTS?.constantInputs?.length) {
    inputBits.push(`<div class="issueRowTitle">Near-constant inputs</div>`);
    inputBits.push(
      `<div class="synapseStats">${
        DIAG_INPUTS.constantInputs.slice(0, 10).map((x) =>
          `<span class="stat">${escapeHtml(x.uuid)} std≈${
            escapeHtml(formatSig(x.std, 3))
          }</span>`
        ).join("")
      }</div>`,
    );
  }
  const correlatedPairs = ensureCorrelatedPairs();
  if (correlatedPairs?.length) {
    inputBits.push(`<div class="issueRowTitle">Highly correlated pairs</div>`);
    inputBits.push(
      `<div class="synapseStats">${
        correlatedPairs.slice(0, 8).map((p) =>
          `<span class="stat">${escapeHtml(p.a)} ↔ ${escapeHtml(p.b)} r=${
            escapeHtml(formatSig(p.r, 4))
          }</span>`
        ).join("")
      }</div>`,
    );
  }
  if (DIAG_INPUTS?.candidateCoverage?.length) {
    inputBits.push(`<div class="issueRowTitle">Candidate coverage</div>`);
    inputBits.push(
      `<div class="synapseStats">${
        DIAG_INPUTS.candidateCoverage.slice(0, 10).map((c) =>
          `<span class="stat">${escapeHtml(c.uuid)} candidates=${
            escapeHtml(String(c.count))
          } (+${escapeHtml(String(c.helpful))}/-${
            escapeHtml(String(c.harmful))
          })</span>`
        ).join("")
      }</div>`,
    );
  }
  pieces.push(
    `<div class="issueRow">${
      inputBits.length
        ? inputBits.join("")
        : `<div class="synapseStats"><span class="stat">No input redundancy data</span></div>`
    }</div>`,
  );

  el.neuronTabPanelIssues.innerHTML = pieces.join("");

  el.neuronTabPanelIssues.onclick = (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;
    const row = target.closest("[data-jump-uuid]");
    if (!row) return;
    const uuid = row.getAttribute("data-jump-uuid");
    if (uuid) navigateTo(uuid);
  };
}

// ============================================================================
// Candidates tab UI
// ============================================================================

function renderCandidatesPanel(currentUuid) {
  if (!el.neuronTabPanelCandidates) return;
  if (!SNAPSHOT) {
    el.neuronTabPanelCandidates.innerHTML = "";
    return;
  }

  const relevant = (DISCOVERY_CANDIDATES ?? []).filter((c) =>
    c?.fromUuid === currentUuid || c?.toUuid === currentUuid
  );

  const selected =
    (DISCOVERY_CANDIDATES ?? []).find((c) => c.key === selectedCandidateKey) ??
      null;

  const list = relevant.length ? relevant : (DISCOVERY_CANDIDATES ?? []);
  const listTitle = relevant.length
    ? "Candidates involving this neuron"
    : "Candidates (snapshot)";

  const rows = list.map((c) => {
    const isSelected = c.key === selectedCandidateKey;
    const title = `${c.type || "candidate"}: ${
      truncateUuid(c.fromUuid ?? "?")
    } → ${truncateUuid(c.toUuid ?? "?")}`;
    const stats = [];
    if (c.expectedScoreGain != null) {
      stats.push(
        `<span class="stat ${
          c.expectedScoreGain >= 0 ? "positive" : "negative"
        }" title="Expected score gain">Δscore: ${
          escapeHtml(formatSig(c.expectedScoreGain, 4))
        }</span>`,
      );
    }
    if (c.expectedImpact != null) {
      stats.push(
        `<span class="stat" title="Expected impact">impact: ${
          escapeHtml(formatSig(c.expectedImpact, 4))
        }</span>`,
      );
    }
    return `
      <div class="candidateRow ${
      isSelected ? "isSelected" : ""
    }" data-cand-key="${escapeHtml(c.key)}">
        <div class="candidateRowTitle">${escapeHtml(title)}</div>
        <div class="synapseStats">${stats.join("")}</div>
      </div>
    `;
  }).join("");

  const detail = selected
    ? renderSplitSynapseCandidateDetail(selected)
    : `<div class="emptyState">Select a candidate to inspect details.</div>`;

  el.neuronTabPanelCandidates.innerHTML = `
    <div class="panelSectionTitle">${escapeHtml(listTitle)}</div>
    <div class="candidateList">${
    rows ||
    `<div class="emptyState">No discovery candidates in this snapshot.</div>`
  }</div>
    <div class="panelSectionTitle">Candidate details</div>
    ${detail}
  `;

  el.neuronTabPanelCandidates.onclick = (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;
    const row = target.closest("[data-cand-key]");
    if (!row) return;
    const key = row.getAttribute("data-cand-key");
    if (!key) return;
    selectedCandidateKey = key;
    renderCandidatesPanel(currentUuid);
    renderSynapseList(currentUuid);
  };
}

function renderSplitSynapseCandidateDetail(c) {
  const isSplit =
    String(c.type ?? "").toLowerCase() === "split_synapse_insert_neuron";

  const from = c.fromUuid ?? "?";
  const to = c.toUuid ?? "?";

  // Small before/after diff summary.
  const diff = `
    <dl class="candidateDiffGrid">
      <dt>Synapse count Δ</dt><dd>+1 (−1 +2)</dd>
      <dt>Neuron count Δ</dt><dd>+1</dd>
      <dt>Removed synapse</dt><dd>${escapeHtml(`${from} → ${to}`)}</dd>
    </dl>
  `;

  const svg = renderCandidateDiagramSvg(c);

  const details = [];
  details.push(
    `<div class="issueRowTitle">${
      escapeHtml(
        isSplit ? "split_synapse_insert_neuron" : (c.type || "candidate"),
      )
    }</div>`,
  );
  details.push(`<div class="synapseStats">`);
  details.push(
    `<span class="stat" title="from/to UUIDs">${
      escapeHtml(`${truncateUuid(from)} → ${truncateUuid(to)}`)
    }</span>`,
  );
  if (c.fromIndex != null || c.toIndex != null) {
    details.push(
      `<span class="stat" title="from/to indices">idx: ${
        escapeHtml(String(c.fromIndex ?? "?"))
      } → ${escapeHtml(String(c.toIndex ?? "?"))}</span>`,
    );
  }
  if (c.oldWeight != null) {
    details.push(
      `<span class="stat" title="Old weight">old w: ${
        escapeHtml(formatSig(c.oldWeight, 6))
      }</span>`,
    );
  }
  if (c.newWeightA != null || c.newWeightB != null) {
    details.push(
      `<span class="stat" title="New weights">new w: ${
        escapeHtml(formatSig(c.newWeightA ?? 0, 6))
      }, ${escapeHtml(formatSig(c.newWeightB ?? 0, 6))}</span>`,
    );
  }
  if (c.newNeuronSquash) {
    details.push(
      `<span class="stat" title="New neuron squash">squash: ${
        escapeHtml(c.newNeuronSquash)
      }</span>`,
    );
  }
  if (c.newNeuronBias != null) {
    details.push(
      `<span class="stat" title="New neuron bias">bias: ${
        escapeHtml(formatSig(c.newNeuronBias, 6))
      }</span>`,
    );
  }
  if (c.expectedScoreGain != null) {
    details.push(
      `<span class="stat ${
        c.expectedScoreGain >= 0 ? "positive" : "negative"
      }" title="Expected score gain">Δscore: ${
        escapeHtml(formatSig(c.expectedScoreGain, 6))
      }</span>`,
    );
  }
  if (c.expectedImpact != null) {
    details.push(
      `<span class="stat" title="Expected impact">impact: ${
        escapeHtml(formatSig(c.expectedImpact, 6))
      }</span>`,
    );
  }
  details.push(`</div>`);

  if (c.comment) {
    details.push(
      `<div class="impactBreakdownNote">${escapeHtml(c.comment)}</div>`,
    );
  }

  const rawJson = escapeHtml(JSON.stringify(c.raw ?? {}, null, 2));

  return `
    <div class="issueRow">
      ${details.join("")}
      ${svg}
      ${diff}
      <details class="pathItem" style="margin-top: 10px;">
        <summary>Raw candidate JSON</summary>
        <pre class="pathEquation" style="white-space: pre-wrap;">${rawJson}</pre>
      </details>
    </div>
  `;
}

function renderCandidateDiagramSvg(c) {
  const from = truncateNeuronName(c.fromUuid ?? "?");
  const to = truncateNeuronName(c.toUuid ?? "?");
  const midSquash = c.newNeuronSquash ?? "IDENTITY";
  const midBias = c.newNeuronBias != null ? formatSig(c.newNeuronBias, 4) : "0";
  const w1 = c.newWeightA != null ? formatSig(c.newWeightA, 4) : "?";
  const w2 = c.newWeightB != null ? formatSig(c.newWeightB, 4) : "?";
  const oldW = c.oldWeight != null ? formatSig(c.oldWeight, 4) : "?";

  // Simple inline SVG: from → ghost → to, with old edge highlighted.
  return `
    <svg class="candidateDiagram" viewBox="0 0 360 120" aria-label="Candidate diagram">
      <defs>
        <marker id="arrowOld" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L8,3 L0,6 Z" fill="var(--warning)"></path>
        </marker>
        <marker id="arrowNew" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L8,3 L0,6 Z" fill="var(--accent)"></path>
        </marker>
      </defs>

      <!-- Old edge (to be replaced) -->
      <line x1="60" y1="60" x2="300" y2="60" class="candidateDiagramOldEdge" marker-end="url(#arrowOld)"></line>
      <text x="180" y="48" text-anchor="middle" class="candidateDiagramText">old w=${
    escapeHtml(oldW)
  }</text>

      <!-- New edges (proposed) -->
      <line x1="60" y1="80" x2="170" y2="80" class="candidateDiagramNewEdge" marker-end="url(#arrowNew)"></line>
      <line x1="190" y1="80" x2="300" y2="80" class="candidateDiagramNewEdge" marker-end="url(#arrowNew)"></line>
      <text x="115" y="100" text-anchor="middle" class="candidateDiagramText">w1=${
    escapeHtml(w1)
  }</text>
      <text x="245" y="100" text-anchor="middle" class="candidateDiagramText">w2=${
    escapeHtml(w2)
  }</text>

      <!-- Nodes -->
      <circle cx="50" cy="60" r="18" class="candidateDiagramNode"></circle>
      <text x="50" y="65" text-anchor="middle" class="candidateDiagramText">from</text>

      <rect x="160" y="18" width="40" height="40" rx="10" class="candidateDiagramGhost"></rect>
      <text x="180" y="40" text-anchor="middle" class="candidateDiagramText">ghost</text>
      <text x="180" y="18" text-anchor="middle" class="candidateDiagramText"></text>

      <circle cx="310" cy="60" r="18" class="candidateDiagramNode"></circle>
      <text x="310" y="65" text-anchor="middle" class="candidateDiagramText">to</text>

      <text x="50" y="18" text-anchor="middle" class="candidateDiagramText">${
    escapeHtml(from)
  }</text>
      <text x="310" y="18" text-anchor="middle" class="candidateDiagramText">${
    escapeHtml(to)
  }</text>

      <text x="180" y="70" text-anchor="middle" class="candidateDiagramText">squash=${
    escapeHtml(midSquash)
  } bias=${escapeHtml(midBias)}</text>
    </svg>
  `;
}

// ============================================================================
// Creature overview dashboard (#103)
// ============================================================================

function showOverviewDashboard() {
  if (el.overviewDashboard) el.overviewDashboard.style.display = "";
  if (el.explorerMain) el.explorerMain.style.display = "none";
}

function showExplorer() {
  if (el.overviewDashboard) el.overviewDashboard.style.display = "none";
  if (el.explorerMain) el.explorerMain.style.display = "";
  // The split container now has a real width — restore the saved panel size
  // against the correct bounds (Issue #510).
  _reapplyExplorerWidth?.();
}

function renderOverviewDashboard() {
  const allNeurons = Array.from(neuronsByUuid.values());
  const breakdown = computeNeuronBreakdown(allNeurons);
  const synStats = computeSynapseStats(synapses, breakdown.total);

  const inputUuids = allNeurons.filter((n) => n.type === "input").map((n) =>
    n.uuid
  );
  const outputUuids = allNeurons.filter((n) => n.type === "output").map((n) =>
    n.uuid
  );
  const depth = computeNetworkDepth(synapses, inputUuids, outputUuids);
  const activationDist = computeActivationDistribution(allNeurons);
  const topology = computeLayerTopology(allNeurons, synapses);

  // Metrics card
  if (el.overviewMetrics) {
    el.overviewMetrics.innerHTML = `
      <dt>Neurons</dt>
      <dd>${formatInteger(breakdown.total)}</dd>
      <dt>Breakdown</dt>
      <dd>${breakdown.input} input · ${breakdown.hidden} hidden · ${breakdown.output} output${
      breakdown.constant > 0 ? ` · ${breakdown.constant} constant` : ""
    }</dd>
      <dt>Synapses</dt>
      <dd>${formatInteger(synStats.total)}</dd>
      <dt>Avg connectivity</dt>
      <dd>${formatDecimal(synStats.avgPerNeuron, 1)} synapses / neuron</dd>
      <dt>Network depth</dt>
      <dd>${depth} layer${depth !== 1 ? "s" : ""}</dd>
    `;
  }

  // Activation distribution card
  if (el.overviewActivation) {
    const sorted = Array.from(activationDist.entries()).sort((a, b) =>
      b[1] - a[1]
    );
    el.overviewActivation.innerHTML = sorted.map(([name, count]) =>
      `<span class="overviewActivationChip"><span class="chipCount">${count}</span> ${
        escapeHtml(name)
      }</span>`
    ).join("");
  }

  // Topology diagram card
  if (el.overviewTopology) {
    renderTopologyDiagram(topology, outputUuids);
  }

  showOverviewDashboard();
}

function renderTopologyInto(container, topology) {
  // Delegate the SVG markup to the pure renderer so it stays testable and
  // DOM-free; we just attach event listeners and the skip-summary line.
  const { svg, skipSynapseCount, skipEdgeCount } = topologyToSvgString(
    topology,
  );

  const parts = [svg];
  if (skipSynapseCount > 0) {
    parts.push(
      `<div class="topoSkipSummary">${skipSynapseCount} skip-connection` +
        `${skipSynapseCount !== 1 ? "s" : ""} (${skipEdgeCount} distinct path${
          skipEdgeCount !== 1 ? "s" : ""
        })</div>`,
    );
  }
  // Inline legend (Issue #240) — explains the dot/link/colour encodings.
  parts.push(topologyLegendHtml());

  container.innerHTML = parts.join("");

  // Click a layer dot → enter the explorer at the first neuron in that layer.
  // Stop propagation so the click does not bubble up to the diagram-background
  // handler that opens the pop-out modal (Issue #241).
  container.querySelectorAll(".topoNode").forEach((nodeEl) => {
    nodeEl.addEventListener("click", (ev) => {
      if (ev && typeof ev.stopPropagation === "function") {
        ev.stopPropagation();
      }
      const idx = parseInt(nodeEl.dataset.layerIndex, 10);
      const layer = topology.layers[idx];
      if (!layer?.uuids?.length) return;
      if (_topoModalCtrl?.isOpen?.()) _topoModalCtrl.close();
      enterExplorer(layer.uuids[0]);
    });
  });
}

/** Most-recently-rendered topology — used to refresh the modal body. */
let _lastTopology = null;

function renderTopologyDiagram(topology, _outputUuids) {
  if (!el.overviewTopology || !topology?.layers?.length) {
    if (el.overviewTopology) {
      el.overviewTopology.innerHTML =
        '<span style="color:var(--muted)">No topology data</span>';
    }
    _lastTopology = null;
    return;
  }

  _lastTopology = topology;
  renderTopologyInto(el.overviewTopology, topology);

  // Issue #241 — clicking the diagram background (anywhere outside a dot)
  // opens the landscape pop-out modal. Dot clicks stop propagation above.
  if (_topoModalCtrl) {
    el.overviewTopology.onclick = (ev) => {
      _topoModalCtrl.open(el.overviewTopology);
      // The opener element is the container itself; the controller will
      // restore focus there on close. Mark as handled.
      if (ev?.preventDefault) ev.preventDefault();
    };
  }
}

/** @type {ReturnType<typeof createTopoModalController>|null} */
let _topoModalCtrl = null;

if (el.topoModal && el.topoModalBackdrop) {
  _topoModalCtrl = createTopoModalController({
    modal: el.topoModal,
    backdrop: el.topoModalBackdrop,
    body: el.topoModalBody,
    closeBtn: el.topoModalClose,
    render: (body) => {
      if (_lastTopology) renderTopologyInto(body, _lastTopology);
    },
  });
}

function enterExplorer(uuid) {
  showExplorer();
  trace = [];
  navigateTo(uuid ?? "output-0");
}

// ============================================================================
// Event Listeners
// ============================================================================

if (el.overviewExploreBtn) {
  el.overviewExploreBtn.onclick = () => {
    const outputs = Array.from(neuronsByUuid.values()).filter((n) =>
      n.type === "output"
    );
    enterExplorer(outputs[0]?.uuid ?? "output-0");
  };
}

el.fetchBtn.onclick = () => {
  const raw = el.fetchUrl.value.trim() || DEFAULT_SNAPSHOT_URL;
  const url = normaliseSnapshotUrl(raw);
  loadSnapshot(url, url);
};

el.fileBtn.onclick = () => el.fileInput.click();

el.fileInput.onchange = async () => {
  const file = el.fileInput.files?.[0];
  if (!file) return;
  try {
    setStatus(`Reading ${file.name}...`);
    showProgress(true); // Indeterminate for local file reading
    const obj = await readSnapshotFile(file);
    hideProgress();
    await loadSnapshot(obj, file.name);
  } catch (e) {
    hideProgress();
    setStatus(e.message, "bad");
  }
};

el.traceBackBtn.onclick = goBack;
el.traceClearBtn.onclick = clearTrace;

el.synapseSort.onchange = () => {
  if (trace.length > 0) {
    resetInboundRenderLimit();
    renderSynapseList(trace[trace.length - 1]);
  }
};

function initInboundFilters() {
  // Defaults can depend on viewport, so compute once at boot.
  inboundTopK = defaultInboundTopK();
  inboundRenderLimit = inboundTopK || 0;
  syncInboundFilterControls();

  if (el.synapseMinAlloc) {
    const debouncedMinAlloc = createDebounce(() => {
      const n = parseMaybeNumber(el.synapseMinAlloc.value);
      inboundMinAllocImpact = n != null && n > 0 ? n : 0;
      resetInboundRenderLimit();
      if (trace.length > 0) renderSynapseList(trace[trace.length - 1]);
    }, 150);
    el.synapseMinAlloc.addEventListener(
      "input",
      () => debouncedMinAlloc.call(),
    );
  }
  if (el.synapseTopK) {
    el.synapseTopK.addEventListener("change", () => {
      const n = parseMaybeNumber(el.synapseTopK.value);
      inboundTopK = n != null
        ? Math.max(0, Math.floor(n))
        : defaultInboundTopK();
      resetInboundRenderLimit();
      if (trace.length > 0) renderSynapseList(trace[trace.length - 1]);
    });
  }
}

el.fetchUrl.onkeydown = (e) => {
  if (e.key === "Enter") el.fetchBtn.click();
};

// ── Resizable explorer split (Issue #510) ───────────────────────────────────
//
// The `.flowArrow` divider between the neuron-detail panel (`.currentNeuron`)
// and the inbound-synapse list (`.synapseList`) becomes a draggable handle on
// desktop. The chosen width is remembered per browser via `localStorage` and
// restored (clamped to the current viewport) on load. Double-click resets it.
//
// Only the desktop layout (≥1024px) has a fixed-width left panel; on tablet
// and phone the panels stack or slide, so the divider is inert there.
const EXPLORER_NEURON_DEFAULT_WIDTH = 320;
const EXPLORER_NEURON_MIN_WIDTH = 280;
const EXPLORER_ARROW_WIDTH = 50;
const EXPLORER_SYNAPSE_MIN_WIDTH = 320;

function explorerResizeEnabled() {
  try {
    return window.matchMedia?.("(min-width: 1024px)")?.matches === true;
  } catch (_e) {
    return false;
  }
}

function explorerNeuronMaxWidth(container) {
  // The container is `display:none` while the overview dashboard is shown, so
  // its measured width is 0. Fall back to the viewport width so a restored
  // size is not wrongly clamped to the minimum before the explorer opens.
  let total = container?.getBoundingClientRect?.().width ?? 0;
  if (!(total > 0)) total = window.innerWidth ?? 0;
  const max = total - EXPLORER_ARROW_WIDTH - EXPLORER_SYNAPSE_MIN_WIDTH;
  return Math.max(EXPLORER_NEURON_MIN_WIDTH, max);
}

// Re-applies the stored explorer width. Assigned by initExplorerResize() and
// invoked when the explorer view is revealed (the container has no width until
// then).
let _reapplyExplorerWidth = null;

function applyExplorerNeuronWidth(neuron, width) {
  if (!(neuron instanceof HTMLElement) || !Number.isFinite(width)) return;
  // `flex-basis` + zero grow/shrink pins the width against the flex sibling.
  neuron.style.flex = `0 0 ${width}px`;
  neuron.style.width = `${width}px`;
}

function clearExplorerNeuronWidth(neuron) {
  if (!(neuron instanceof HTMLElement)) return;
  neuron.style.removeProperty("flex");
  neuron.style.removeProperty("width");
}

function initExplorerResize() {
  const container = document.querySelector(".explorerMain");
  const neuron = document.querySelector(".currentNeuron");
  const divider = document.querySelector(".flowArrow");
  if (
    !(container instanceof HTMLElement) ||
    !(neuron instanceof HTMLElement) ||
    !(divider instanceof HTMLElement)
  ) {
    return;
  }

  const key = PANEL_SIZE_KEYS.explorerNeuron;

  const applyStored = () => {
    if (!explorerResizeEnabled()) {
      // Let the stylesheet own the layout on tablet/phone.
      clearExplorerNeuronWidth(neuron);
      return;
    }
    const width = resolveInitialPanelSize({
      stored: loadPanelSize(key),
      fallback: EXPLORER_NEURON_DEFAULT_WIDTH,
      min: EXPLORER_NEURON_MIN_WIDTH,
      max: explorerNeuronMaxWidth(container),
    });
    applyExplorerNeuronWidth(neuron, width);
  };

  // Turn the arrow into an accessible vertical separator.
  divider.setAttribute("role", "separator");
  divider.setAttribute("aria-orientation", "vertical");
  divider.setAttribute("aria-label", "Resize neuron detail panel");
  divider.setAttribute("tabindex", "0");
  divider.classList.add("isResizable");

  let dragging = false;
  let startX = 0;
  let startWidth = 0;

  const onPointerMove = (e) => {
    if (!dragging) return;
    const next = computeDragPanelSize({
      startSize: startWidth,
      delta: e.clientX - startX,
      min: EXPLORER_NEURON_MIN_WIDTH,
      max: explorerNeuronMaxWidth(container),
    });
    if (next !== null) applyExplorerNeuronWidth(neuron, next);
  };

  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    divider.classList.remove("isDragging");
    savePanelSize(key, neuron.getBoundingClientRect().width, undefined);
  };

  divider.addEventListener("pointerdown", (e) => {
    if (!explorerResizeEnabled()) return;
    dragging = true;
    startX = e.clientX;
    startWidth = neuron.getBoundingClientRect().width;
    divider.classList.add("isDragging");
    try {
      divider.setPointerCapture(e.pointerId);
    } catch (_e) { /* setPointerCapture can throw on stale ids */ }
    e.preventDefault();
  });
  divider.addEventListener("pointermove", onPointerMove);
  divider.addEventListener("pointerup", endDrag);
  divider.addEventListener("pointercancel", endDrag);

  // Keyboard: arrow keys nudge the boundary for non-pointer users.
  divider.addEventListener("keydown", (e) => {
    if (!explorerResizeEnabled()) return;
    const step = e.shiftKey ? 40 : 12;
    let delta = 0;
    if (e.key === "ArrowLeft") delta = -step;
    else if (e.key === "ArrowRight") delta = step;
    else return;
    const next = computeDragPanelSize({
      startSize: neuron.getBoundingClientRect().width,
      delta,
      min: EXPLORER_NEURON_MIN_WIDTH,
      max: explorerNeuronMaxWidth(container),
    });
    if (next !== null) {
      applyExplorerNeuronWidth(neuron, next);
      savePanelSize(key, next, undefined);
    }
    e.preventDefault();
  });

  // Double-click / double-tap resets this boundary to its default.
  divider.addEventListener("dblclick", () => {
    if (!explorerResizeEnabled()) return;
    clearPanelSize(key, undefined);
    applyExplorerNeuronWidth(neuron, EXPLORER_NEURON_DEFAULT_WIDTH);
    savePanelSize(key, EXPLORER_NEURON_DEFAULT_WIDTH, undefined);
  });

  // Re-clamp to the new viewport when the window resizes.
  window.addEventListener("resize", applyStored);

  // Let showExplorer() re-apply once the container has a measurable width.
  _reapplyExplorerWidth = applyStored;

  applyStored();
}

// ============================================================================
// Init
// ============================================================================

const params = new URLSearchParams(window.location.search);
const snapshotUrlB64Param = params.get("snapshotUrlB64");
const snapshotUrlParam = params.get("snapshotUrl") ?? params.get("url") ??
  params.get("file");

// Issue #184 / Issue #204: there is a single #themeToggle button.
// syncThemeTogglePlacement() relocates it between .headerControls and
// .traceButtons based on viewport width, so we only ever bind one button.
initThemeMode({ toggleButtonId: "themeToggle" });
// Issue #383: overflow menu wiring runs once via initCompactTraceNav() below.
// The previous standalone call here bound the toggle a second time, so a tap
// fired both listeners and cancelled out — the popover never opened.
initTouchTooltips();
initInboundFilters();
initInlineFiltersLayout();
initCompactTraceNav();
initExplorerResize();

// Provide an easy on-ramp to the 3D graph explorer, carrying the current query
// params (e.g. snapshotUrl / snapshotUrlB64) across.
if (el.graphBtn instanceof HTMLAnchorElement) {
  el.graphBtn.href = `./graph/${window.location.search ?? ""}`;
}

let initialUrl = null;
let initialLabel = null;

if (snapshotUrlB64Param) {
  const decoded = decodeBase64UrlToUtf8(snapshotUrlB64Param);
  if (decoded && !isDangerousUrlScheme(decoded)) {
    initialUrl = decoded;
    initialLabel = decoded;
  }
} else if (snapshotUrlParam && !isDangerousUrlScheme(snapshotUrlParam)) {
  initialUrl = snapshotUrlParam;
  initialLabel = snapshotUrlParam;
}

// Auto-load with top-level retry (Issue #118). The first fetch can fail due to
// Service Worker activation timing or transient network issues, even after the
// per-fetch retries in fetchJson(). This outer retry loop gives the system more
// time to settle before giving up.
async function autoLoadWithRetry(url, label) {
  for (let attempt = 0; attempt <= AUTO_LOAD_MAX_RETRIES; attempt++) {
    await loadSnapshot(url, label);
    if (SNAPSHOT) return; // Success — snapshot was populated.

    // Still no snapshot after loadSnapshot (it caught the error internally).
    if (attempt < AUTO_LOAD_MAX_RETRIES) {
      const delay = AUTO_LOAD_RETRY_DELAY_MS * Math.pow(2, attempt);
      const secs = Math.round(delay / 1000);
      setStatus(`Load failed — retrying in ${secs}s...`, "warn");
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

if (initialUrl) {
  el.fetchUrl.value = initialUrl;
  autoLoadWithRetry(initialUrl, initialLabel ?? initialUrl).catch((e) => {
    setStatus(e.message ?? "Auto-load failed", "bad");
    console.error("Auto-load failed:", e);
  });
} else {
  el.fetchUrl.value = DEFAULT_SNAPSHOT_URL;
  setStatus(`Loading default snapshot: ${DEFAULT_SNAPSHOT_URL}`);
  autoLoadWithRetry(DEFAULT_SNAPSHOT_URL, DEFAULT_SNAPSHOT_URL).catch((e) => {
    setStatus(e.message ?? "Auto-load failed", "bad");
    console.error("Auto-load failed:", e);
  });
}
