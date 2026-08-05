/**
 * NEAT-AI Explore — top-impact subgraph view (Issue #527).
 *
 * The third candidate replacement for the 3D starfield: instead of showing
 * everything, show only the highest-contributing paths to the Score, and state
 * how much of the network that leaves out.
 *
 * All heavy lifting is done by DOM-free shared modules — extraction by
 * `shared/subgraph_model.js`, geometry and SVG by `shared/dag_layout.js` — so
 * this file only wires the DOM: snapshot loading, the N/threshold controls,
 * path selection, and the dead-zone summary.
 */

import {
  AUTO_LOAD_MAX_RETRIES,
  AUTO_LOAD_RETRY_DELAY_MS,
  DEFAULT_SNAPSHOT_URL,
  SNAPSHOT_FALLBACK_URLS,
} from "../shared/config.js";
import {
  DEFAULT_IMPACT_THRESHOLD,
  DEFAULT_TOP_PATHS,
  describeSubgraphPath,
  extractTopImpactSubgraph,
  subgraphLegendHtml,
} from "../shared/subgraph_model.js";
import {
  computeDagLayout,
  dagLayoutToSvgString,
} from "../shared/dag_layout.js";
import { escapeHtml } from "../shared/ui_helpers.js";
import {
  loadFallbackTooltips,
  mergeTooltipMaps,
  needsFallbackTooltips,
} from "../shared/tooltips_fallback.js";
import { formatInteger } from "../shared/number_format.js";
import { createProgressUi } from "../shared/progress_ui.js";
import { deriveSubgraphFromRequest } from "../shared/subgraph_derivation.js";
import {
  phaseProgressPercent,
  runSubgraphDerivation,
  SUBGRAPH_PHASE_LABELS,
} from "../shared/subgraph_worker_client.js";
import {
  createIndexedDbStore,
  deriveSubgraphCached,
  fetchVersionSignal,
  fileVersionSignal,
} from "../shared/subgraph_cache.js";

/** The subgraph is compact by construction, so a column rarely overflows. */
const MAX_NODES_PER_COLUMN = 24;

const el = {
  fetchUrl: document.getElementById("fetchUrl"),
  fetchBtn: document.getElementById("fetchBtn"),
  fileBtn: document.getElementById("fileBtn"),
  fileInput: document.getElementById("fileInput"),
  snapshotDetails: document.getElementById("snapshotDetails"),
  topPaths: document.getElementById("topPaths"),
  impactThreshold: document.getElementById("impactThreshold"),
  status: document.getElementById("status"),
  progressContainer: document.getElementById("progressContainer"),
  progressBar: document.getElementById("progressBar"),
  summaryLine: document.getElementById("summaryLine"),
  diagram: document.getElementById("diagram"),
  pathPicker: document.getElementById("pathPicker"),
  pathBody: document.getElementById("pathBody"),
  deadZoneBody: document.getElementById("deadZoneBody"),
  legendBody: document.getElementById("legendBody"),
};

/** @type {Record<string, string>} */
let labels = {};
/** @type {Record<string, string>} */
let descriptions = {};
/** @type {Awaited<ReturnType<typeof deriveSubgraphFromRequest>>["source"]|null} */
let source = null;
/** @type {ReturnType<typeof extractTopImpactSubgraph>|null} */
let subgraph = null;
/** @type {ReturnType<typeof computeDagLayout>|null} */
let layout = null;
/** @type {string} */
let selectedInputUuid = "";

// ---------------------------------------------------------------------------
// Status / progress
// ---------------------------------------------------------------------------

// One shared widget controller instead of a private copy per view (#597).
// The view now pulses an unknown-size load via `.indeterminate` like the
// Trace and Graph views, instead of faking it with a static 35% bar.
const { setStatus, showProgress, updateProgress, hideProgress } =
  createProgressUi(el);

// ---------------------------------------------------------------------------
// Snapshot loading — off the main thread (Issue #560)
//
// download → gunzip → parse → rank all run in a Web Worker so the page stays
// interactive on a phone while a 15.9 MB gzipped snapshot loads. The worker
// streams honest phase/progress messages back; only the cheap
// `extractTopImpactSubgraph` (re-run on every control change) stays on the main
// thread.
// ---------------------------------------------------------------------------

/**
 * Construct the derivation Web Worker, cache-busted to match this module so a
 * deploy never pairs a fresh page with a stale worker. Returns null when the
 * platform has no module-Worker support, so the caller can fall back to the
 * main thread.
 * @returns {Worker|null}
 */
function createDerivationWorker() {
  try {
    if (typeof Worker === "undefined") return null;
    const workerUrl = new URL("./subgraph_worker.js", import.meta.url);
    // Carry the page module's ?v=<build id> onto the worker URL so both are
    // invalidated together by the Service Worker.
    workerUrl.search = new URL(import.meta.url).search;
    return new Worker(workerUrl, { type: "module" });
  } catch (e) {
    console.warn(
      "Subgraph worker unavailable — deriving on the main thread:",
      e,
    );
    return null;
  }
}

/** Advance the progress bar honestly for a phase (0..1 within the phase). */
function reportPhase(phase, fraction = 0) {
  setStatus(SUBGRAPH_PHASE_LABELS[phase] ?? "Working…");
  showProgress(false);
  updateProgress(phaseProgressPercent(phase, fraction));
}

/**
 * Build the derivation request for a URL or an uploaded file. The default
 * snapshot carries the CORS fallback mirrors (Issue #93); everything else and
 * every file upload runs without them.
 * @param {string|File} input
 * @returns {import("../shared/subgraph_derivation.js").SubgraphRequest}
 */
function toRequest(input) {
  if (typeof input === "string") {
    return {
      type: "url",
      url: input,
      fallbacks: input === DEFAULT_SNAPSHOT_URL ? SNAPSHOT_FALLBACK_URLS : [],
    };
  }
  return { type: "file", file: input };
}

/**
 * On-device cache for the derived result (Issue #561), created once and reused.
 * Null where IndexedDB is unavailable, so the app runs uncached without a
 * branch at every call site (fail open).
 * @type {ReturnType<typeof createIndexedDbStore>|null|undefined}
 */
let derivedCache;

/** Lazily open the derived-result cache; a fault leaves it disabled. */
function getDerivedCache() {
  if (derivedCache === undefined) {
    try {
      derivedCache = createIndexedDbStore();
    } catch (e) {
      console.warn("Derived-subgraph cache unavailable — running uncached:", e);
      derivedCache = null;
    }
  }
  return derivedCache;
}

/**
 * A cheap content/version signal for a request, used to invalidate the cache
 * when the snapshot changes. Uploaded files key on their metadata; URLs key on
 * a HEAD request's ETag/Last-Modified. Returns null (bypass the cache, fail
 * open) when no trustworthy signal is available.
 * @param {import("../shared/subgraph_derivation.js").SubgraphRequest} request
 * @returns {Promise<string|null>}
 */
function versionSignalFor(request) {
  if (request?.type === "file") {
    return Promise.resolve(fileVersionSignal(request.file));
  }
  return fetchVersionSignal(request?.url ?? "");
}

/**
 * Run the full download → gunzip → parse → rank derivation, off the main thread
 * when a Worker is available and on it otherwise. Progress is honest either way.
 * @param {import("../shared/subgraph_derivation.js").SubgraphRequest} request
 * @param {import("../shared/subgraph_derivation.js").DerivationHandlers} handlers
 */
async function runDerivation(request, handlers) {
  const worker = createDerivationWorker();
  if (worker) {
    try {
      return await runSubgraphDerivation(worker, request, handlers);
    } finally {
      worker.terminate?.();
    }
  }
  // Legacy fallback: no module Worker support. Same pipeline, same honest
  // progress — but the heavy steps run on the main thread.
  return await deriveSubgraphFromRequest(request, handlers);
}

/**
 * Derive the ranked subgraph source for a request, serving a cached result on a
 * fresh repeat visit so the expensive derivation is skipped (Issue #561). The
 * cache fails open: a miss, a changed snapshot, or any store fault falls through
 * to {@link runDerivation}.
 * @param {import("../shared/subgraph_derivation.js").SubgraphRequest} request
 */
async function deriveSubgraph(request) {
  const handlers = {
    onPhase: (phase) => reportPhase(phase, 0),
    onProgress: (p) => {
      if (p?.totalBytes) {
        reportPhase("download", p.receivedBytes / p.totalBytes);
      }
    },
  };

  const signal = await versionSignalFor(request);
  return await deriveSubgraphCached({
    request,
    signal,
    store: getDerivedCache(),
    handlers,
    derive: runDerivation,
    onCacheHit: () => {
      // A repeat visit skips download/parse/rank entirely — jump the bar to
      // done rather than animating phases that never run.
      setStatus("Loaded the cached subgraph");
      updateProgress(100);
    },
  });
}

/**
 * Issue #521 — older snapshots carry no embedded Tooltips.json. Merge in the
 * bundled copy so observation hovers still show a summary; the snapshot always
 * wins where it has data.
 */
async function applyFallbackTooltips() {
  if (!needsFallbackTooltips({ descriptions })) return;
  try {
    const fallback = await loadFallbackTooltips();
    descriptions = mergeTooltipMaps(descriptions, fallback.descriptions);
    labels = mergeTooltipMaps(labels, fallback.labels ?? {});
  } catch (e) {
    // The bundle is committed to this repo, so a failure here is a real
    // deploy/serving fault — surface it rather than silently dropping text.
    console.error("Bundled observation tooltips unavailable:", e);
  }
}

/**
 * Load a snapshot (URL or file), derive its ranked source off the main thread,
 * and render. Returns true on success so the auto-load retry loop can react
 * without inspecting global state.
 * @param {string|File} input
 * @param {string} label
 * @returns {Promise<boolean>}
 */
async function loadSnapshot(input, label) {
  try {
    // Size is unknown until the first phase reports, so pulse (#597) — an
    // updateProgress(0) here would cancel the pulse before it is ever seen.
    setStatus(`Loading ${label}…`);
    showProgress(true);

    // The whole download → gunzip → parse → rank derivation runs off the main
    // thread; only the returned source (structured-cloned back) lands here.
    const result = await deriveSubgraph(toRequest(input));
    source = result.source;
    labels = result.labels;
    descriptions = result.descriptions;
    await applyFallbackTooltips();
    el.snapshotDetails?.removeAttribute?.("open");

    updateProgress(100);
    hideProgress();
    selectedInputUuid = "";
    render();
    return true;
  } catch (e) {
    // Fail loud rather than leaving a frozen "Loading…" (Issue #3234).
    hideProgress();
    setStatus(e?.message ?? String(e), "bad");
    console.error("Snapshot load failed:", e);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function controlValues() {
  const topPaths = Number(el.topPaths?.value ?? DEFAULT_TOP_PATHS);
  const impactThreshold = Number(
    el.impactThreshold?.value ?? DEFAULT_IMPACT_THRESHOLD,
  );
  return {
    topPaths: Number.isFinite(topPaths) ? topPaths : DEFAULT_TOP_PATHS,
    impactThreshold: Number.isFinite(impactThreshold)
      ? impactThreshold
      : DEFAULT_IMPACT_THRESHOLD,
  };
}

function render() {
  if (!source) return;
  setStatus("Extracting the top-impact paths…");

  subgraph = extractTopImpactSubgraph(source, controlValues());
  renderDeadZone();
  renderPathPicker();

  if (subgraph.nodes.length === 0) {
    // An empty result is a control setting, not a fault — say so plainly
    // instead of rendering a blank box.
    layout = null;
    if (el.diagram) {
      el.diagram.innerHTML =
        `<p class="emptyState">No path clears the minimum share. Lower the ` +
        `<strong>Min share</strong> control to widen the subgraph.</p>`;
    }
    renderSummary();
    setStatus("No path clears the threshold", "warn");
    return;
  }

  layout = computeDagLayout(subgraph, {
    tooltips: { labels, descriptions },
    maxNodesPerColumn: MAX_NODES_PER_COLUMN,
  });
  if (el.diagram) el.diagram.innerHTML = dagLayoutToSvgString(layout);
  renderSummary();
  if (selectedInputUuid) selectPath(selectedInputUuid);

  setStatus(
    `${formatInteger(subgraph.paths.length)} paths · ${
      formatInteger(layout.nodes.length)
    } nodes · ${formatInteger(layout.edges.length)} links`,
    "good",
  );
}

function renderSummary() {
  if (!el.summaryLine || !subgraph) return;
  const dz = subgraph.deadZone;
  const shown = subgraph.paths.reduce((acc, p) => acc + p.score, 0);
  const parts = [
    `${formatInteger(subgraph.paths.length)} of ${
      formatInteger(subgraph.meta.rankedPathCount)
    } observation paths shown`,
    `${(shown * 100).toFixed(1)}% of the Score explained`,
    `${formatInteger(dz.excludedNeurons)} of ${
      formatInteger(dz.totalNeurons)
    } neurons excluded`,
  ];
  if (subgraph.meta.walkTruncated) {
    // The attribution walk hit its work cap — the ranking is a lower bound,
    // and saying so beats presenting it as complete.
    parts.push("ranking truncated at the work cap");
  }
  el.summaryLine.textContent = parts.join(" · ");
}

function renderDeadZone() {
  if (!el.deadZoneBody || !subgraph) return;
  const dz = subgraph.deadZone;
  el.deadZoneBody.innerHTML = [
    `<p class="deadZoneLead">Everything below is excluded from the subgraph —`,
    ` each excluded region is a candidate dead zone.</p>`,
    `<dl class="detailsGrid">`,
    `<dt>Observations</dt><dd>${formatInteger(dz.excludedObservations)} of ${
      formatInteger(dz.totalObservations)
    }</dd>`,
    `<dt>Neurons</dt><dd>${formatInteger(dz.excludedNeurons)} of ${
      formatInteger(dz.totalNeurons)
    }</dd>`,
    `<dt>Aggregate nodes</dt><dd>${formatInteger(dz.excludedNodes)} of ${
      formatInteger(dz.totalNodes)
    }</dd>`,
    `<dt>No path to Score</dt><dd>${formatInteger(dz.unreachableNeurons)}</dd>`,
    `</dl>`,
  ].join("");
}

function renderPathPicker() {
  if (!el.pathPicker || !subgraph) return;
  const options = subgraph.paths.map((path) => {
    const name = labels[path.inputUuid] ?? path.inputUuid;
    return `<option value="${escapeHtml(path.inputUuid)}">${
      escapeHtml(name)
    } (${(path.score * 100).toFixed(1)}%)</option>`;
  });
  el.pathPicker.innerHTML = `<option value="">Select a path…</option>${
    options.join("")
  }`;
  const stillPresent = subgraph.paths.some((p) =>
    p.inputUuid === selectedInputUuid
  );
  if (!stillPresent) selectedInputUuid = "";
  el.pathPicker.value = selectedInputUuid;
  if (!selectedInputUuid && el.pathBody) {
    el.pathBody.textContent =
      "Pick a path (or tap a node in the diagram) to see how an observation reaches the Score.";
  }
}

/** Render the drill-down for one path, and highlight it in the diagram. */
function selectPath(inputUuid) {
  if (!subgraph || !el.pathBody) return;
  const path = subgraph.paths.find((p) => p.inputUuid === inputUuid);
  if (!path) return;
  selectedInputUuid = inputUuid;
  if (el.pathPicker) el.pathPicker.value = inputUuid;

  const onPath = new Set(path.nodeIds);
  for (const group of el.diagram?.querySelectorAll?.(".dagNode") ?? []) {
    group.classList.toggle(
      "isSelected",
      onPath.has(group.getAttribute("data-node-id")),
    );
  }
  const onPathEdges = new Set();
  for (let i = 1; i < path.nodeIds.length; i++) {
    onPathEdges.add(`${path.nodeIds[i - 1]}=>${path.nodeIds[i]}`);
  }
  for (const group of el.diagram?.querySelectorAll?.(".dagEdge") ?? []) {
    group.classList.toggle(
      "isSelected",
      onPathEdges.has(group.getAttribute("data-edge-id")),
    );
  }

  const description = describeSubgraphPath(path, { labels, descriptions });
  el.pathBody.innerHTML = [
    `<h3 class="detailsTitle">${
      escapeHtml(labels[path.inputUuid] ?? path.inputUuid)
    }</h3>`,
    `<pre class="pathDetail">${escapeHtml(description)}</pre>`,
  ].join("");
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

el.diagram?.addEventListener?.("click", (event) => {
  const group = event.target?.closest?.(".dagNode");
  const nodeId = group?.getAttribute?.("data-node-id");
  if (!nodeId || !subgraph) return;
  // Tapping a node drills into the strongest path that runs through it.
  const path = subgraph.paths.find((p) => p.nodeIds.includes(nodeId));
  if (path) selectPath(path.inputUuid);
});

el.pathPicker?.addEventListener?.("change", () => {
  const inputUuid = el.pathPicker?.value ?? "";
  if (inputUuid) selectPath(inputUuid);
});

el.topPaths?.addEventListener?.("change", () => {
  if (source) render();
});

el.impactThreshold?.addEventListener?.("change", () => {
  if (source) render();
});

el.fetchBtn?.addEventListener?.("click", () => {
  const raw = String(el.fetchUrl?.value ?? "").trim() || DEFAULT_SNAPSHOT_URL;
  if (el.fetchUrl) el.fetchUrl.value = raw;
  loadSnapshot(raw, raw);
});

el.fetchUrl?.addEventListener?.("keydown", (event) => {
  if (event.key === "Enter") el.fetchBtn?.click?.();
});

el.fileBtn?.addEventListener?.("click", () => el.fileInput?.click?.());

el.fileInput?.addEventListener?.("change", async () => {
  const file = el.fileInput?.files?.[0];
  if (!file) return;
  // The File is handed straight to the worker — read, gunzip and parse all
  // happen off the main thread too (Issue #560).
  await loadSnapshot(file, file.name);
});

if (el.legendBody) el.legendBody.innerHTML = subgraphLegendHtml();
if (el.fetchUrl) el.fetchUrl.value = DEFAULT_SNAPSHOT_URL;

/**
 * Boot with the default snapshot, retrying on transient failures (Issue #118).
 * `?noAutoLoad=1` skips the fetch so pa11y-ci can settle the page without a
 * network round trip.
 */
async function autoLoadWithRetry(url) {
  for (let attempt = 0; attempt <= AUTO_LOAD_MAX_RETRIES; attempt++) {
    if (await loadSnapshot(url, url)) return;
    if (attempt < AUTO_LOAD_MAX_RETRIES) {
      const delay = AUTO_LOAD_RETRY_DELAY_MS * Math.pow(2, attempt);
      setStatus(
        `Load failed — retrying in ${Math.round(delay / 1000)}s…`,
        "warn",
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  // Every attempt failed: say so loudly rather than leaving "Loading…" up.
  throw new Error(`Could not load the snapshot from ${url}`);
}

const bootParams = new URLSearchParams(
  typeof location !== "undefined" ? location.search : "",
);
if (bootParams.get("noAutoLoad") !== "1") {
  autoLoadWithRetry(DEFAULT_SNAPSHOT_URL).catch((e) => {
    setStatus(e?.message ?? "Auto-load failed", "bad");
    console.error("Auto-load failed:", e);
  });
} else {
  setStatus("Ready — load a snapshot to extract the top-impact paths.");
}
