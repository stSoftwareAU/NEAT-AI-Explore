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
  fetchSnapshotJson,
  readSnapshotFile,
} from "../shared/snapshot_loader.js";
import {
  buildSubgraphSource,
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
import { escapeHtml, extractTooltips } from "../shared/ui_helpers.js";
import {
  loadFallbackTooltips,
  mergeTooltipMaps,
  needsFallbackTooltips,
} from "../shared/tooltips_fallback.js";
import { formatInteger } from "../shared/number_format.js";

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

/** @type {unknown} */
let snapshot = null;
/** @type {Record<string, string>} */
let labels = {};
/** @type {Record<string, string>} */
let descriptions = {};
/** @type {ReturnType<typeof buildSubgraphSource>|null} */
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

function setStatus(text, cls = "") {
  if (!el.status) return;
  el.status.textContent = text;
  el.status.className = `statusInline${cls ? ` ${cls}` : ""}`;
}

function showProgress(indeterminate) {
  if (!el.progressContainer || !el.progressBar) return;
  el.progressContainer.style.display = "block";
  el.progressBar.style.width = indeterminate
    ? "35%"
    : el.progressBar.style.width;
}

function updateProgress(percent) {
  if (!el.progressBar) return;
  const clamped = Math.max(0, Math.min(100, percent));
  el.progressBar.style.width = `${clamped}%`;
}

function hideProgress() {
  if (!el.progressContainer) return;
  el.progressContainer.style.display = "none";
}

// ---------------------------------------------------------------------------
// Snapshot loading (mirrors the DAG view, Issues #93 / #118)
// ---------------------------------------------------------------------------

async function loadSnapshotFromUrl(url) {
  setStatus(`Loading ${url}…`);
  showProgress(true);

  const onProgress = (p) => {
    if (!p.totalBytes) {
      showProgress(true);
      return;
    }
    updateProgress((p.receivedBytes / p.totalBytes) * 100);
  };

  try {
    const obj = await fetchSnapshotJson(url, { onProgress });
    hideProgress();
    return obj;
  } catch (e) {
    // GitHub Pages can be blocked by CORS on some networks — try the mirrors
    // before giving up (Issue #93).
    if (String(url) === DEFAULT_SNAPSHOT_URL) {
      for (const fallback of SNAPSHOT_FALLBACK_URLS) {
        if (!fallback || fallback === url) continue;
        try {
          setStatus(`Trying fallback ${fallback}…`);
          const obj = await fetchSnapshotJson(fallback, { onProgress });
          hideProgress();
          return obj;
        } catch (_e) {
          // Keep trying the next fallback.
        }
      }
    }
    hideProgress();
    throw e;
  }
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

async function loadSnapshot(input, label) {
  try {
    setStatus(`Loading ${label}…`);
    snapshot = typeof input === "string"
      ? await loadSnapshotFromUrl(input)
      : input;
    const tooltips = extractTooltips(snapshot);
    labels = tooltips.labels;
    descriptions = tooltips.descriptions;
    await applyFallbackTooltips();
    el.snapshotDetails?.removeAttribute?.("open");

    // The ranked walk does not depend on the controls, so it runs once per
    // snapshot and every control change re-uses it.
    setStatus("Ranking contributions to the Score…");
    source = buildSubgraphSource(snapshot);
    selectedInputUuid = "";
    render();
  } catch (e) {
    hideProgress();
    setStatus(e?.message ?? String(e), "bad");
    console.error("Snapshot load failed:", e);
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
  try {
    setStatus(`Reading ${file.name}…`);
    showProgress(true);
    const obj = await readSnapshotFile(file);
    hideProgress();
    await loadSnapshot(obj, file.name);
  } catch (e) {
    hideProgress();
    setStatus(e?.message ?? String(e), "bad");
  }
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
    await loadSnapshot(url, url);
    if (snapshot) return;
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
