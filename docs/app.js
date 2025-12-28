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
  computeGradientProxyImpact,
  computeOutgoingProxyTerms,
  computePreActivations,
  computeSquashDerivativeStats,
  summariseDeadZoneStats,
  summariseErrorConcentration,
  summariseSeriesStats,
} from "./impact_diagnostics.js";

let SNAPSHOT = null;
let synapses = [];
let neuronsByUuid = new Map();
let trace = []; // Array of neuron UUIDs
let uuidToLabel = {}; // "input-N" -> "human-name"
let uuidToDescription = {}; // "input-N" -> "Tooltip description"

let DIAG_PRE = new Map();
let DIAG_SQUASH = new Map();
let DIAG_PROXY = new Map();
let DIAG_PRE_STATS = new Map();
let DIAG_DEADZONES = new Map();
let DIAG_NONFINITE = new Map();
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

// Default snapshot used when the app is opened without a URL parameter.
// This keeps the PWA immediately usable on iPhone/iPad without needing a file
// picker (which can be awkward in standalone mode).
// Note: avoid a leading "./" because some static hosts treat "/./file" as a
// distinct path (and may 404) rather than normalising it.
const DEFAULT_SNAPSHOT_URL = "snapshot.json.gz";

// Thresholds for highlighting
const IMPACT_HIGHLIGHT_THRESHOLD = 0.1; // Highlight if impact > 0.1
const IMPACT_SUSPICIOUS_THRESHOLD = 1e-8; // Suspiciously low - should be prunable
const MSE_ERROR_THRESHOLD = 0.3; // Highlight if MSE > 0.3

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
  "Samples": "Number of observations recorded for this neuron",
  "Max Recon Δ":
    "Maximum reconstruction delta - largest difference between recorded activation and recomputed activation from inputs. High values suggest recording or squash function issues.",
};

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
  themeToggle: document.getElementById("themeToggle"),
  progressContainer: document.getElementById("progressContainer"),
  progressBar: document.getElementById("progressBar"),
  status: document.getElementById("status"),
  traceBreadcrumb: document.getElementById("traceBreadcrumb"),
  traceBackBtn: document.getElementById("traceBackBtn"),
  traceClearBtn: document.getElementById("traceClearBtn"),
  currentNeuronTitle: document.getElementById("currentNeuronTitle"),
  neuronProps: document.getElementById("neuronProps"),
  impactBreakdown: document.getElementById("impactBreakdown"),
  impactDiagnosticsPanel: document.getElementById("impactDiagnosticsPanel"),
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
  synapseCount: document.getElementById("synapseCount"),
  synapseSort: document.getElementById("synapseSort"),
  synapseListContainer: document.getElementById("synapseListContainer"),
};

// ============================================================================
// Input labels and descriptions (from snapshot.tooltips)
// ============================================================================

function loadInputLabelsFromSnapshot(snapshot) {
  const tooltipsByUuid = snapshot?.tooltips ?? snapshot?.meta?.tooltips ?? null;
  if (!tooltipsByUuid || typeof tooltipsByUuid !== "object") {
    uuidToLabel = {};
    uuidToDescription = {};
    return;
  }

  uuidToLabel = {};
  uuidToDescription = {};

  for (const [uuid, info] of Object.entries(tooltipsByUuid)) {
    if (!uuid || typeof uuid !== "string") continue;
    if (!info || typeof info !== "object") continue;
    const label = info.label;
    const description = info.description;
    if (typeof label === "string" && label.trim().length > 0) {
      uuidToLabel[uuid] = label;
    }
    if (typeof description === "string" && description.trim().length > 0) {
      uuidToDescription[uuid] = description;
    }
  }
}

function getAlias(uuid) {
  return uuidToLabel[uuid] ?? null;
}

function getInputDescription(uuid) {
  return uuidToDescription[uuid] ?? null;
}

// ============================================================================
// Status & Loading
// ============================================================================

function setStatus(msg, kind = "") {
  el.status.textContent = msg;
  el.status.className = "statusInline " + kind;
}

/**
 * Show the progress bar.
 * @param {boolean} indeterminate - If true, show pulsing animation (unknown size).
 */
function showProgress(indeterminate = false) {
  if (!el.progressContainer || !el.progressBar) return;
  el.progressContainer.style.display = "";
  el.progressBar.style.width = indeterminate ? "" : "0%";
  if (indeterminate) {
    el.progressBar.classList.add("indeterminate");
  } else {
    el.progressBar.classList.remove("indeterminate");
  }
}

/**
 * Update the progress bar percentage.
 * @param {number} percent - Progress percentage (0-100).
 */
function updateProgress(percent) {
  if (!el.progressBar) return;
  el.progressBar.classList.remove("indeterminate");
  el.progressBar.style.width = `${Math.min(100, Math.max(0, percent))}%`;
}

/**
 * Hide the progress bar.
 */
function hideProgress() {
  if (!el.progressContainer) return;
  el.progressContainer.style.display = "none";
}

async function gunzipToText(gzBytes) {
  // Prefer the native streaming API when available (modern Chromium/Firefox).
  // Some Safari/iOS builds still lack DecompressionStream, so fall back to a
  // small JS implementation (vendored in ./vendor/fflate.browser.js).
  if (typeof DecompressionStream !== "undefined") {
    try {
      const stream = new Blob([gzBytes]).stream().pipeThrough(
        new DecompressionStream("gzip"),
      );
      return await new Response(stream).text();
    } catch (_e) {
      // Fall through to JS gunzip.
    }
  }

  try {
    const { gunzipSync } = await import("./vendor/fflate.browser.js");
    const out = gunzipSync(gzBytes);
    return new TextDecoder().decode(out);
  } catch (_e) {
    throw new Error(
      "This snapshot is gzipped (.gz) but this browser can't decompress it. Export/upload an uncompressed .json, or use a browser with gzip support.",
    );
  }
}

function normaliseSnapshotUrl(inputUrl) {
  const raw = String(inputUrl ?? "").trim();
  if (!raw) return raw;

  // Don't touch absolute URLs (including blob: for file picker flows).
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) return raw;

  // Normalise dot-segments for relative paths. Some hosts/CDNs treat "/./x" as
  // a different resource path rather than normalising it.
  let u = raw;
  while (u.startsWith("./")) u = u.slice(2);
  u = u.replaceAll("/./", "/");
  return u;
}

// ============================================================================
// Theme mode (Light/Dark/Auto)
// ============================================================================

const THEME_STORAGE_KEY = "themeMode";
const THEME_COLOUR_LIGHT = "#f5f7fb";
const THEME_COLOUR_DARK = "#0a0e1a";

// In privacy modes, localStorage can be blocked (throws on access). We keep an
// in-memory fallback so the theme toggle can still cycle within the current
// session, even if we cannot persist it across reloads.
let themeModeMemory = "auto";
let themeCanPersist = false;

function normaliseThemeMode(mode) {
  const m = String(mode ?? "auto");
  if (m === "auto" || m === "light" || m === "dark") return m;
  return "auto";
}

function canUseLocalStorage() {
  try {
    const k = "__neat_theme_test__";
    localStorage.setItem(k, "1");
    localStorage.removeItem(k);
    return true;
  } catch (_e) {
    return false;
  }
}

function safeGetThemeMode() {
  try {
    return normaliseThemeMode(
      localStorage.getItem(THEME_STORAGE_KEY) ?? "auto",
    );
  } catch (_e) {
    // Some browsers throw on localStorage access in strict privacy modes.
    return "auto";
  }
}

function getSystemTheme() {
  try {
    return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches
      ? "dark"
      : "light";
  } catch (_e) {
    return "light";
  }
}

function setThemeColourForMode(mode) {
  const metas = document.querySelectorAll('meta[name="theme-color"]');
  if (!metas?.length) return;
  const resolved = mode === "auto" ? getSystemTheme() : mode;
  // Keep this simple: align the browser UI colour with the page background.
  const colour = resolved === "dark" ? THEME_COLOUR_DARK : THEME_COLOUR_LIGHT;
  for (const meta of metas) meta.setAttribute("content", colour);
}

function applyThemeMode(mode) {
  const m = normaliseThemeMode(mode);
  themeModeMemory = m;

  const root = document.documentElement;
  if (m === "dark" || m === "light") {
    root.setAttribute("data-theme", m);
  } else {
    root.removeAttribute("data-theme");
  }
  setThemeColourForMode(m);

  if (themeCanPersist) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, m);
    } catch (_e) {
      // Storage can become unavailable (private mode / blocked storage).
      themeCanPersist = false;
    }
  }
}

function themeModeLabel(mode) {
  if (mode === "light") return "Light";
  if (mode === "dark") return "Dark";
  return "Auto";
}

function themeModeGlyph(mode) {
  if (mode === "light") return "☀";
  if (mode === "dark") return "☾";
  return "A";
}

function cycleThemeMode(current) {
  if (current === "auto") return "light";
  if (current === "light") return "dark";
  return "auto";
}

function initThemeMode() {
  const btn = el.themeToggle;
  if (!btn) return;

  themeCanPersist = canUseLocalStorage();
  const saved = themeCanPersist ? safeGetThemeMode() : "auto";

  applyThemeMode(saved);

  const updateButton = (mode) => {
    btn.textContent = themeModeGlyph(mode);
    btn.title = `Theme: ${themeModeLabel(mode)} (tap to cycle)`;
    btn.setAttribute("aria-label", btn.title);
  };

  updateButton(themeModeMemory);

  btn.addEventListener("click", () => {
    // Use in-memory state so we can still cycle when localStorage is blocked.
    const next = cycleThemeMode(themeModeMemory);
    applyThemeMode(next);
    updateButton(themeModeMemory);
  });

  // Keep Auto mode in sync with OS theme changes.
  try {
    const mql = window.matchMedia?.("(prefers-color-scheme: dark)");
    mql?.addEventListener?.("change", () => {
      // Only applies to Auto mode (no explicit data-theme override).
      if (themeModeMemory === "auto") setThemeColourForMode("auto");
    });
  } catch (_e) {
    // No-op.
  }
}

function isSameOriginUrl(url) {
  try {
    const u = new URL(String(url), window.location.href);
    return u.origin === window.location.origin;
  } catch (_e) {
    return false;
  }
}

async function fetchJson(url) {
  const u = normaliseSnapshotUrl(url);
  const canUseCacheFallback = isSameOriginUrl(u) &&
    typeof caches !== "undefined" &&
    typeof caches.match === "function";

  let res;
  let usedCache = false;
  let cacheReason = "";

  // Network-first: always attempt the fresh version when possible.
  try {
    res = await fetch(u, { cache: "no-store" });
  } catch (e) {
    // Browser blocks cross-origin fetches without CORS headers (common with S3 presigned URLs).
    // fetch() rejects with TypeError("Failed to fetch") in that case.
    if (e?.message === "Failed to fetch") {
      throw new Error(
        "Failed to fetch (likely CORS). If this is an S3 presigned URL, add a bucket CORS rule allowing origin https://stsoftwareau.github.io (GET/HEAD).",
      );
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
      cache.put(u, res.clone());
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
      if (usedCache) obj.__loadedFromCache = cacheReason || true;
      return obj;
    }

    // Parse JSON from the raw bytes
    const text = new TextDecoder().decode(allChunks);
    const obj = JSON.parse(text);
    if (usedCache) obj.__loadedFromCache = cacheReason || true;
    return obj;
  }

  // Fallback: no streaming (e.g., body unavailable)
  if (looksGz && !ce.includes("gzip")) {
    const buf = new Uint8Array(await res.arrayBuffer());
    const text = await gunzipToText(buf);
    const obj = JSON.parse(text);
    if (usedCache) obj.__loadedFromCache = cacheReason || true;
    return obj;
  }

  const obj = await res.json();
  if (usedCache && obj && typeof obj === "object") {
    obj.__loadedFromCache = cacheReason || true;
  }
  return obj;
}

function normaliseCreature(snapshot) {
  const creature = snapshot?.creature ?? snapshot?.creatureJson;
  if (!creature) throw new Error("No creature in snapshot");

  const rawSynapses = creature.synapses ?? [];
  synapses = rawSynapses.map((s) => {
    const fromUuid = s.fromUuid ?? s.fromUUID ?? s.from_uuid;
    const toUuid = s.toUuid ?? s.toUUID ?? s.to_uuid;
    const weight = s.weight;
    if (!fromUuid || !toUuid || typeof weight !== "number") return null;
    return { fromUuid, toUuid, weight };
  }).filter(Boolean);

  const rawNeurons = creature.neurons ?? [];
  neuronsByUuid = new Map(rawNeurons.map((n) => [n.uuid, n]));

  const inputCount = creature.input ?? 0;
  for (let i = 0; i < inputCount; i++) {
    const uuid = `input-${i}`;
    if (!neuronsByUuid.has(uuid)) {
      neuronsByUuid.set(uuid, {
        uuid,
        type: "input",
        squash: "IDENTITY",
        bias: 0,
      });
    }
  }

  return creature;
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
      obj.__loadedFromCache != null;
    if (loadedFromCache) delete obj.__loadedFromCache;

    SNAPSHOT = obj;
    loadInputLabelsFromSnapshot(SNAPSHOT);
    const creature = normaliseCreature(obj);

    const neuronCount = (creature.neurons ?? []).filter((n) =>
      n.type !== "input"
    ).length;
    const inputCount = creature.input ?? 0;

    const baseStatus =
      `Observations: ${inputCount.toLocaleString()}, Neurons: ${neuronCount.toLocaleString()} & Synapses: ${synapses.length.toLocaleString()}`;
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
      DIAG_ERROR_TAIL = computeErrorConcentrationIssues({
        recording: SNAPSHOT?.recording ?? null,
      });
      DISCOVERY_CANDIDATES = extractDiscoveryCandidates(SNAPSHOT);
      DIAG_INPUTS = computeInputIssues({
        recording: SNAPSHOT?.recording ?? null,
        inputCount: creature.input ?? 0,
        candidates: DISCOVERY_CANDIDATES,
      });
    } catch (e) {
      console.warn("Impact diagnostics failed (non-fatal):", e);
      DIAG_PRE = new Map();
      DIAG_PRE_STATS = new Map();
      DIAG_SQUASH = new Map();
      DIAG_PROXY = new Map();
      DIAG_DEADZONES = new Map();
      DIAG_NONFINITE = new Map();
      DIAG_ERROR_TAIL = new Map();
      DIAG_INPUTS = {
        constantInputs: [],
        correlatedPairs: [],
        candidateCoverage: [],
      };
      DISCOVERY_CANDIDATES = [];
    }

    selectedCandidateKey = null;
    currentNeuronTab = "details";
    trace = [];
    navigateTo(startUuid);
  } catch (e) {
    hideProgress();
    setStatus(e.message, "bad");
    console.error(e);
  }
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

  const existingIndex = trace.indexOf(uuid);
  if (existingIndex >= 0) {
    trace = trace.slice(0, existingIndex + 1);
  } else {
    trace.push(uuid);
  }

  renderTrace();
  renderCurrentNeuron(uuid);
  renderSynapseList(uuid);
}

function goBack() {
  if (trace.length > 1) {
    trace.pop();
    const uuid = trace[trace.length - 1];
    renderTrace();
    renderCurrentNeuron(uuid);
    renderSynapseList(uuid);
  }
}

function clearTrace() {
  if (trace.length > 0) {
    const first = trace[0];
    trace = [first];
    renderTrace();
  }
}

// ============================================================================
// Render Functions
// ============================================================================

function renderTrace() {
  el.traceBreadcrumb.innerHTML = "";

  trace.forEach((uuid) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.textContent = truncateNeuronName(uuid);
    const alias = getAlias(uuid);
    const desc = getInputDescription(uuid);
    btn.title = uuid +
      (alias ? ` (${alias})` : "") +
      (desc ? ` — ${desc}` : "");
    btn.onclick = () => navigateTo(uuid);
    li.appendChild(btn);
    el.traceBreadcrumb.appendChild(li);
  });
}

function truncateUuid(uuid) {
  if (uuid.length <= 16) return uuid;
  return uuid.slice(0, 8) + "…" + uuid.slice(-4);
}

function truncateNeuronName(uuid) {
  const alias = getAlias(uuid);
  if (alias) {
    return alias.length > 20 ? alias.slice(0, 18) + "…" : alias;
  }
  return truncateUuid(uuid);
}

function getImpactClass(impact) {
  if (impact == null) return "";
  if (impact > IMPACT_HIGHLIGHT_THRESHOLD) return "highlight";
  if (impact < IMPACT_SUSPICIOUS_THRESHOLD && impact >= 0) return "suspicious";
  return "";
}

function renderCurrentNeuron(uuid) {
  const n = neuronsByUuid.get(uuid) ??
    { uuid, type: "input", squash: "IDENTITY", bias: 0 };
  const alias = getAlias(uuid);
  const desc = getInputDescription(uuid);
  const isInput = uuid.startsWith("input-");

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

  const stats = getNeuronStats(uuid);
  const impact = getNeuronImpact(uuid);
  const check = getReconstructionCheck(uuid);

  const props = [];
  props.push(["Type", n.type ?? "unknown"]);

  // Only show squash/bias for non-input neurons (inputs don't have these)
  if (!isInput) {
    props.push(["Squash", n.squash ?? "IDENTITY"]);
    props.push(["Bias", formatNumber(n.bias)]);
  }

  if (impact != null) {
    const impactClass = getImpactClass(impact);
    const impactNote = impact < IMPACT_SUSPICIOUS_THRESHOLD ? " ⚠️" : "";
    props.push(["Impact", formatSig(impact, 3) + impactNote, impactClass]);
  }

  // Impact diagnostics: show-your-working-style evidence for squash issues.
  if (!isInput) {
    const preStats = DIAG_PRE_STATS.get(uuid);
    if (preStats && preStats.n > 0) {
      props.push(["Pre-activation mean", formatSig(preStats.mean, 4)]);
      props.push([
        "Pre-activation range",
        `${formatSig(preStats.min, 4)} → ${formatSig(preStats.max, 4)}`,
      ]);
      props.push(["Pre-activation p99", formatSig(preStats.p99, 4)]);
      props.push(["Pre-activation |x| max", formatSig(preStats.maxAbs, 4)]);
    }

    const proxy = DIAG_PROXY.get(uuid);
    if (typeof proxy === "number" && isFinite(proxy)) {
      props.push(["Impact (proxy, grad)", formatSig(proxy, 3)]);
    }
    const s = DIAG_SQUASH.get(uuid);
    if (s) {
      props.push(["Squash |d| mean", formatSig(s.meanAbsD, 3)]);
      props.push(["Squash d≈0 %", formatSig(s.fracNearZero * 100, 3) + "%"]);
      if (s.nonSmooth) {
        props.push([
          "Squash warning",
          s.note ?? "non-smooth / branching",
          "error",
          squashWarningExplanation(s.note, n.squash),
        ]);
      }
    }
  }

  if (stats) {
    props.push(["Mean Activation", formatNumber(stats.meanActivation)]);
    props.push([
      "Activation Range",
      `${formatNumber(stats.activationMin)} → ${
        formatNumber(stats.activationMax)
      }`,
    ]);

    // Only show error for non-input neurons
    if (!isInput) {
      const mse = stats.meanSquaredError ?? stats.mean_squared_error;
      const mae = stats.meanAbsoluteError ?? stats.mean_absolute_error;
      if (mse != null) {
        const errorClass = mse > MSE_ERROR_THRESHOLD ? "error" : "";
        props.push(["MSE", formatSig(mse, 3), errorClass]);
      }
      if (mae != null) {
        props.push(["MAE", formatSig(mae, 3)]);
      }
    }
    props.push(["Samples", stats.recordCount ?? "N/A"]);
  }

  if (!isInput && check) {
    const maxDelta = check.maxActivationDelta ?? check.max_activation_delta;
    const deltaClass = maxDelta > 0.01 ? "error" : "";
    props.push(["Max Recon Δ", formatSig(maxDelta, 3), deltaClass]);
  }

  el.neuronProps.innerHTML = "";
  props.forEach(([label, value, cls, valueTitle]) => {
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
    el.neuronProps.appendChild(dt);
    el.neuronProps.appendChild(dd);
  });

  renderImpactBreakdown(uuid, impact);
  renderImpactDiagnosticsPanel(uuid, n.type);
  renderIssuesPanel(uuid, n.type);
  renderCandidatesPanel(uuid);
  applyNeuronTabState();
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
        <div class="impactBreakdownOut">${escapeHtml(toLabel)}</div>
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

  const allocation = computeInboundSynapseImpactAllocation({
    toUuid: uuid,
    neuronImpact: neuronImpact ?? null,
    inboundSynapses: inbound.map((s) => ({
      fromUuid: s.fromUuid,
      toUuid: s.toUuid,
      weight: s.weight,
      meanContribution: getMeanContribution(s.fromUuid, s.toUuid),
    })),
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
        <div class="impactBreakdownOut">${escapeHtml(fromLabel)}</div>
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
  lastInboundPage = 0;
  el.pathModal.classList.add("isOpen");
  el.pathModal.setAttribute("aria-hidden", "false");
  renderInboundModalPage();
}

function closePathModal() {
  if (!el.pathModal) return;
  el.pathModal.classList.remove("isOpen");
  el.pathModal.setAttribute("aria-hidden", "true");
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

function getInboundSynapses(toUuid) {
  return synapses.filter((s) => s.toUuid === toUuid);
}

function renderSynapseList(toUuid) {
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
  const allocation = computeInboundSynapseImpactAllocation({
    toUuid,
    neuronImpact: currentImpact ?? null,
    inboundSynapses: inbound.map((s) => ({
      fromUuid: s.fromUuid,
      toUuid: s.toUuid,
      weight: s.weight,
      meanContribution: getMeanContribution(s.fromUuid, s.toUuid),
    })),
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
    return {
      ...syn,
      impact,
      mse,
      contrib,
      alias,
      isInput,
      allocImpact,
      allocShare,
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

  el.synapseListContainer.innerHTML = "";

  enriched.forEach((syn) => {
    const row = document.createElement("div");
    row.className = "synapseRow";
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
      }" title="Weight: strength of connection">w: ${
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
      statsHtml.push(
        `<span class="stat" title="Allocated impact into the current neuron (sums to current neuron's impact)">alloc imp: ${
          formatSig(syn.allocImpact, 3)
        }</span>`,
      );
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
      <div class="synapseFrom">
        ${nameHtml}
        <span class="neuronType">${fromType}</span>
      </div>
      <div class="synapseStats">${statsHtml.join("")}</div>
      <div class="synapseNav">→</div>
    `;

    row.onclick = () => navigateTo(syn.fromUuid);
    el.synapseListContainer.appendChild(row);
  });
}

function formatNumber(n, decimals = 4) {
  if (n == null || typeof n !== "number") return "N/A";
  if (!isFinite(n)) return String(n);
  return n.toFixed(decimals);
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

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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
// Issues tab computations (cached on snapshot load)
// ============================================================================

function extractDiscoveryCandidates(snapshot) {
  // Discovery snapshots have varied schema across versions. Keep this defensive.
  const candidates = snapshot?.derived?.candidates ??
    snapshot?.derived?.discoveryCandidates ??
    snapshot?.derived?.discovery_candidates ??
    snapshot?.discovery?.candidates ??
    snapshot?.discoveryCandidates ??
    snapshot?.candidates ??
    [];

  const arr = Array.isArray(candidates) ? candidates : [];
  return arr.map((c, idx) => normaliseCandidate(c, idx)).filter(Boolean);
}

function normaliseCandidate(raw, idx) {
  if (!raw || typeof raw !== "object") return null;

  const type = String(
    raw.type ?? raw.kind ?? raw.candidateType ?? raw.candidate_type ?? "",
  ).trim();

  // Helper: safe nested getter by trying multiple field paths.
  function pick(...paths) {
    for (const p of paths) {
      const v = p(raw);
      if (v != null) return v;
    }
    return null;
  }

  function asStr(v) {
    return typeof v === "string" && v.trim() ? v.trim() : null;
  }

  function asNum(v) {
    return typeof v === "number" && isFinite(v) ? v : null;
  }

  const fromUuid = asStr(pick(
    (o) => o.fromUuid,
    (o) => o.from_uuid,
    (o) => o.fromUUID,
    (o) => o.synapse?.fromUuid,
    (o) => o.synapse?.from_uuid,
  ));
  const toUuid = asStr(pick(
    (o) => o.toUuid,
    (o) => o.to_uuid,
    (o) => o.toUUID,
    (o) => o.synapse?.toUuid,
    (o) => o.synapse?.to_uuid,
  ));

  const fromIndex = asNum(pick((o) => o.fromIndex, (o) => o.from_index));
  const toIndex = asNum(pick((o) => o.toIndex, (o) => o.to_index));

  const oldWeight = asNum(pick(
    (o) => o.oldWeight,
    (o) => o.old_weight,
    (o) => o.weight,
    (o) => o.synapse?.weight,
  ));

  // New weights: allow arrays or explicit fields.
  const newWeightsArr = pick((o) => o.newWeights, (o) => o.new_weights);
  const newWeightA = asNum(
    pick(
      (o) => Array.isArray(newWeightsArr) ? newWeightsArr[0] : null,
      (o) => o.newWeightA,
      (o) => o.new_weight_a,
      (o) => o.w1,
    ),
  );
  const newWeightB = asNum(
    pick(
      (o) => Array.isArray(newWeightsArr) ? newWeightsArr[1] : null,
      (o) => o.newWeightB,
      (o) => o.new_weight_b,
      (o) => o.w2,
    ),
  );

  const newNeuron = raw.newNeuron ?? raw.neuron ?? raw.insertedNeuron ??
    raw.inserted_neuron ?? null;
  const newNeuronSquash = asStr(
    newNeuron?.squash ?? raw.newNeuronSquash ?? raw.new_neuron_squash,
  );
  const newNeuronBias = asNum(
    newNeuron?.bias ?? raw.newNeuronBias ?? raw.new_neuron_bias,
  );

  const expectedScoreGain = asNum(
    pick(
      (o) => o.expectedScoreGain,
      (o) => o.expected_score_gain,
      (o) => o.scoreGain,
    ),
  );
  const expectedImpact = asNum(pick((o) => o.expectedImpact, (o) => o.impact));
  const comment = asStr(
    pick((o) => o.comment, (o) => o.note, (o) => o.diagnostics),
  );

  const key = asStr(raw.id) ??
    asStr(raw.uuid) ??
    `${type || "candidate"}:${fromUuid ?? "?"}→${toUuid ?? "?"}:${idx}`;

  return {
    key,
    type,
    fromUuid,
    toUuid,
    fromIndex,
    toIndex,
    oldWeight,
    newWeightA,
    newWeightB,
    newNeuronSquash,
    newNeuronBias,
    expectedScoreGain,
    expectedImpact,
    comment,
    raw,
  };
}

function computeNonFiniteIssues({ recording }) {
  const obsIndices = recording?.obsIndices ?? recording?.obs_indices ?? null;
  const neurons = recording?.neurons ?? {};
  const out = new Map();

  function obsAt(pos) {
    if (Array.isArray(obsIndices) && pos >= 0 && pos < obsIndices.length) {
      return obsIndices[pos];
    }
    return pos;
  }

  function scan1d(arr) {
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

  function scan2d(arr) {
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

function computeErrorConcentrationIssues({ recording }) {
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

  // Highly correlated input pairs (guard-railed).
  const correlatedPairs = computeTopInputCorrelations({
    recording,
    inputCount,
    maxInputs: 80,
    sampleSize: 512,
    topK: 12,
  });

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

  return { constantInputs, correlatedPairs, candidateCoverage: coverage };
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

function computeTopInputCorrelations(
  { recording, inputCount, maxInputs, sampleSize, topK },
) {
  const neurons = recording?.neurons ?? {};
  const nInputs = Math.max(0, Math.floor(inputCount ?? 0));
  const useInputs = Math.min(nInputs, Math.max(0, Math.floor(maxInputs ?? 80)));
  if (useInputs < 2) return [];

  const seriesByUuid = [];
  for (let i = 0; i < useInputs; i++) {
    const uuid = `input-${i}`;
    const rec = neurons?.[uuid];
    const series = rec?.activation ?? rec?.value ?? null;
    if (Array.isArray(series) && series.length > 4) {
      seriesByUuid.push({ uuid, series });
    }
  }
  if (seriesByUuid.length < 2) return [];

  // Downsample evenly to keep this fast.
  function sampleSeries(arr) {
    const take = Math.min(
      arr.length,
      Math.max(8, Math.floor(sampleSize ?? 512)),
    );
    if (take >= arr.length) return arr;
    const step = arr.length / take;
    const out = [];
    for (let i = 0; i < take; i++) {
      const idx = Math.min(arr.length - 1, Math.floor(i * step));
      const v = arr[idx];
      out.push(typeof v === "number" && isFinite(v) ? v : 0);
    }
    return out;
  }

  const sampled = seriesByUuid.map((s) => ({
    uuid: s.uuid,
    arr: sampleSeries(s.series),
  }));

  // Compute top correlations (|r| high).
  const k = Math.max(1, Math.floor(topK ?? 12));
  /** @type {{ a: string, b: string, r: number }[]} */
  const top = [];

  function insert(item) {
    // keep ascending by |r|
    const ar = Math.abs(item.r);
    let lo = 0;
    let hi = top.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (Math.abs(top[mid].r) <= ar) lo = mid + 1;
      else hi = mid;
    }
    top.splice(lo, 0, item);
    if (top.length > k) top.shift();
  }

  function corr(x, y) {
    const n = Math.min(x.length, y.length);
    if (n < 3) return 0;
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (let i = 0; i < n; i++) {
      const a = x[i];
      const b = y[i];
      sx += a;
      sy += b;
      sxx += a * a;
      syy += b * b;
      sxy += a * b;
    }
    const mx = sx / n;
    const my = sy / n;
    const vx = sxx / n - mx * mx;
    const vy = syy / n - my * my;
    const cov = sxy / n - mx * my;
    const denom = Math.sqrt(Math.max(0, vx)) * Math.sqrt(Math.max(0, vy));
    if (denom <= 0) return 0;
    return cov / denom;
  }

  for (let i = 0; i < sampled.length; i++) {
    for (let j = i + 1; j < sampled.length; j++) {
      const r = corr(sampled[i].arr, sampled[j].arr);
      if (top.length < k || Math.abs(r) > Math.abs(top[0].r)) {
        insert({ a: sampled[i].uuid, b: sampled[j].uuid, r });
      }
    }
  }

  top.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));
  return top;
}

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

  // Non-finite activations / errors.
  if (nonFinite) {
    const dd = [];
    if (nonFinite.activation?.count > 0) {
      dd.push(
        `Non-finite activations: ${nonFinite.activation.count} (first obs_index=${nonFinite.activation.firstObsIndex})`,
      );
    }
    if (nonFinite.value?.count > 0) {
      dd.push(
        `Non-finite values: ${nonFinite.value.count} (first obs_index=${nonFinite.value.firstObsIndex})`,
      );
    }
    if (nonFinite.errors?.count > 0) {
      dd.push(
        `Non-finite errors: ${nonFinite.errors.count} (first obs_index=${nonFinite.errors.firstObsIndex})`,
      );
    }
    pieces.push(`
      <div class="issueRow">
        <div class="issueRowTitle">Exploding / non-finite</div>
        <div class="synapseStats">${
      dd.length
        ? dd.map((x) => `<span class="stat error">${escapeHtml(x)}</span>`)
          .join("")
        : `<span class="stat">No non-finite values detected</span>`
    }</div>
      </div>
    `);
  } else {
    pieces.push(`
      <div class="issueRow">
        <div class="issueRowTitle">Exploding / non-finite</div>
        <div class="synapseStats"><span class="stat">No non-finite values detected</span></div>
      </div>
    `);
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

  const nonFiniteUuids = Array.from(DIAG_NONFINITE.entries())
    .sort((a, b) => (b[1]?.total ?? 0) - (a[1]?.total ?? 0))
    .slice(0, 10);

  const clampedUuids = Array.from(DIAG_DEADZONES.entries())
    .filter(([uuid, d]) => uuid && d && d.fracClamped != null)
    .sort((a, b) => (b[1].fracClamped ?? 0) - (a[1].fracClamped ?? 0))
    .slice(0, 10);

  const deadReluUuids = Array.from(DIAG_DEADZONES.entries())
    .filter(([uuid, d]) => uuid && d && d.fracAtZero != null)
    .sort((a, b) => (b[1].fracAtZero ?? 0) - (a[1].fracAtZero ?? 0))
    .slice(0, 10);

  const heavyTail = Array.from(DIAG_ERROR_TAIL.entries())
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
    "Non-finite (top 10)",
    nonFiniteUuids,
    (d) =>
      `<span class="stat error">count: ${
        escapeHtml(String(d.total ?? 0))
      }</span>` +
      (d.errors?.firstObsIndex != null
        ? `<span class="stat">first obs_index: ${
          escapeHtml(String(d.errors.firstObsIndex))
        }</span>`
        : ""),
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
  if (DIAG_INPUTS?.correlatedPairs?.length) {
    inputBits.push(`<div class="issueRowTitle">Highly correlated pairs</div>`);
    inputBits.push(
      `<div class="synapseStats">${
        DIAG_INPUTS.correlatedPairs.slice(0, 8).map((p) =>
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
// Event Listeners
// ============================================================================

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
    let obj;
    if (file.name.toLowerCase().endsWith(".gz")) {
      const buf = new Uint8Array(await file.arrayBuffer());
      const text = await gunzipToText(buf);
      obj = JSON.parse(text);
    } else {
      const text = await file.text();
      obj = JSON.parse(text);
    }
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
    renderSynapseList(trace[trace.length - 1]);
  }
};

el.fetchUrl.onkeydown = (e) => {
  if (e.key === "Enter") el.fetchBtn.click();
};

// ============================================================================
// Init
// ============================================================================

const params = new URLSearchParams(window.location.search);
const snapshotUrlB64Param = params.get("snapshotUrlB64");
const snapshotUrlParam = params.get("snapshotUrl") ?? params.get("url") ??
  params.get("file");

initThemeMode();
initTouchTooltips();

function decodeBase64UrlToUtf8(base64Url) {
  // Base64url decode for query params (avoids needing to percent-encode presigned URLs).
  // See RFC 4648 §5.
  try {
    const base64 = base64Url.replaceAll("-", "+").replaceAll("_", "/");
    const pad = "=".repeat((4 - (base64.length % 4)) % 4);
    const bin = atob(base64 + pad);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch (_e) {
    return null;
  }
}

function isDangerousUrlScheme(s) {
  const v = String(s ?? "").trim().toLowerCase();
  return v.startsWith("javascript:") || v.startsWith("data:");
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

if (initialUrl) {
  el.fetchUrl.value = initialUrl;
  loadSnapshot(initialUrl, initialLabel ?? initialUrl);
} else {
  el.fetchUrl.value = DEFAULT_SNAPSHOT_URL;
  setStatus(`Loading default snapshot: ${DEFAULT_SNAPSHOT_URL}`);
  loadSnapshot(DEFAULT_SNAPSHOT_URL, DEFAULT_SNAPSHOT_URL);
}
