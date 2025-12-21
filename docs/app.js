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
  if (n === "undefined for x≤0") {
    return `Undefined for x≤0 means the squash isn't differentiable/defined in that region (e.g. SQRT(max(0,x))). (squash: ${s})`;
  }
  if (n === "non-smooth/branching") {
    return `Non-smooth/branching squashes (e.g. IF/MIN/MAX/STEP) can change behaviour discontinuously. Derivative-based impact calculations can be misleading. (squash: ${s})`;
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
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const resolved = mode === "auto" ? getSystemTheme() : mode;
  // Keep this simple: align the browser UI colour with the page background.
  meta.setAttribute("content", resolved === "dark" ? "#0a0e1a" : "#f5f7fb");
}

function applyThemeMode(mode) {
  const m = String(mode ?? "auto");
  const root = document.documentElement;
  if (m === "dark" || m === "light") {
    root.setAttribute("data-theme", m);
  } else {
    root.removeAttribute("data-theme");
  }
  setThemeColourForMode(m);

  try {
    localStorage.setItem(THEME_STORAGE_KEY, m);
  } catch (_e) {
    // Ignore storage failures (private mode / blocked storage).
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

  let saved = "auto";
  try {
    saved = localStorage.getItem(THEME_STORAGE_KEY) ?? "auto";
  } catch (_e) {
    saved = "auto";
  }
  if (saved !== "auto" && saved !== "light" && saved !== "dark") saved = "auto";

  applyThemeMode(saved);

  const updateButton = (mode) => {
    btn.textContent = themeModeGlyph(mode);
    btn.title = `Theme: ${themeModeLabel(mode)} (tap to cycle)`;
    btn.setAttribute("aria-label", btn.title);
  };

  updateButton(saved);

  btn.addEventListener("click", () => {
    const current = localStorage.getItem(THEME_STORAGE_KEY) ?? "auto";
    const next = cycleThemeMode(current);
    applyThemeMode(next);
    updateButton(next);
  });

  // Keep Auto mode in sync with OS theme changes.
  try {
    const mql = window.matchMedia?.("(prefers-color-scheme: dark)");
    mql?.addEventListener?.("change", () => {
      // Only applies to Auto mode (no explicit data-theme override).
      const mode = localStorage.getItem(THEME_STORAGE_KEY) ?? "auto";
      if (mode === "auto") setThemeColourForMode("auto");
    });
  } catch (_e) {
    // No-op.
  }
}

async function fetchJson(url) {
  let res;
  try {
    res = await fetch(normaliseSnapshotUrl(url), { cache: "no-store" });
  } catch (e) {
    // Browser blocks cross-origin fetches without CORS headers (common with S3 presigned URLs).
    // fetch() rejects with TypeError("Failed to fetch") in that case.
    if (e?.message === "Failed to fetch") {
      throw new Error(
        "Failed to fetch (likely CORS). If this is an S3 presigned URL, add a bucket CORS rule allowing origin https://stsoftwareau.github.io (GET/HEAD).",
      );
    }
    throw e;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

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
      return JSON.parse(text);
    }

    // Parse JSON from the raw bytes
    const text = new TextDecoder().decode(allChunks);
    return JSON.parse(text);
  }

  // Fallback: no streaming (e.g., body unavailable)
  if (looksGz && !ce.includes("gzip")) {
    const buf = new Uint8Array(await res.arrayBuffer());
    const text = await gunzipToText(buf);
    return JSON.parse(text);
  }

  return res.json();
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
    SNAPSHOT = obj;
    loadInputLabelsFromSnapshot(SNAPSHOT);
    const creature = normaliseCreature(obj);

    const neuronCount = (creature.neurons ?? []).filter((n) =>
      n.type !== "input"
    ).length;
    const inputCount = creature.input ?? 0;

    setStatus(
      `Observations: ${inputCount.toLocaleString()}, Neurons: ${neuronCount.toLocaleString()} & Synapses: ${synapses.length.toLocaleString()}`,
      "ok",
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
    } catch (e) {
      console.warn("Impact diagnostics failed (non-fatal):", e);
      DIAG_PRE = new Map();
      DIAG_SQUASH = new Map();
      DIAG_PROXY = new Map();
    }

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
  // Provide press-and-hold tooltips on touch devices, without stealing normal taps.
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
      if (n?.getAttribute && n.hasAttribute("title")) {
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
      shownForTarget = null;

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

  // If we just showed a tooltip, suppress the follow-up click so we don't
  // accidentally trigger navigation (e.g. tapping a stat inside a synapse row).
  document.addEventListener(
    "click",
    (e) => {
      if (Date.now() > suppressClickUntil) return;
      const target = findTooltipTarget(e.target);
      if (!target) return;
      if (shownForTarget && target === shownForTarget) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    { capture: true },
  );

  // Tap anywhere outside the tooltip to close it.
  document.addEventListener(
    "touchstart",
    (e) => {
      if (!tooltipEl?.classList.contains("isOpen")) return;
      if (tooltipEl.contains(e.target)) return;
      hideTouchTooltip();
    },
    { passive: true },
  );
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
