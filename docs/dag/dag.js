/**
 * NEAT-AI Explore — layered 2D DAG view (Issue #525).
 *
 * The primary candidate replacement for the 3D starfield: observation families
 * on the left, hidden layers in topological order, the output on the right,
 * with impact encoded in node size/colour and contribution in link width.
 *
 * All heavy lifting is done by DOM-free shared modules — aggregation by
 * `shared/aggregated_graph_model.js`, geometry and SVG by
 * `shared/dag_layout.js` — so this file only wires the DOM: snapshot loading,
 * the detail-level control, node selection, and the details panel.
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
import { buildAggregatedGraphModel } from "../shared/aggregated_graph_model.js";
import {
  computeDagLayout,
  dagLayoutToSvgString,
  dagLegendHtml,
} from "../shared/dag_layout.js";
import {
  buildObservationTooltip,
  escapeHtml,
  extractTooltips,
} from "../shared/ui_helpers.js";
import {
  loadFallbackTooltips,
  mergeTooltipMaps,
  needsFallbackTooltips,
} from "../shared/tooltips_fallback.js";
import { formatInteger } from "../shared/number_format.js";

/** Members listed in the details panel before the list is truncated. */
const MAX_DETAIL_MEMBERS = 40;

/**
 * Detail levels: how aggressively the model collapses low-impact neurons, and
 * how many rows a column may draw before the weakest fold into one aggregate.
 */
const DETAIL_LEVELS = {
  coarse: { collapseThreshold: 0.05, maxNodesPerColumn: 8 },
  balanced: { collapseThreshold: 0.01, maxNodesPerColumn: 12 },
  fine: { collapseThreshold: 0.002, maxNodesPerColumn: 20 },
};

const el = {
  fetchUrl: document.getElementById("fetchUrl"),
  fetchBtn: document.getElementById("fetchBtn"),
  fileBtn: document.getElementById("fileBtn"),
  fileInput: document.getElementById("fileInput"),
  snapshotDetails: document.getElementById("snapshotDetails"),
  detailLevel: document.getElementById("detailLevel"),
  status: document.getElementById("status"),
  progressContainer: document.getElementById("progressContainer"),
  progressBar: document.getElementById("progressBar"),
  summaryLine: document.getElementById("summaryLine"),
  diagram: document.getElementById("diagram"),
  nodePicker: document.getElementById("nodePicker"),
  detailsBody: document.getElementById("detailsBody"),
  legendBody: document.getElementById("legendBody"),
};

/** @type {unknown} */
let snapshot = null;
/** @type {Record<string, string>} */
let labels = {};
/** @type {Record<string, string>} */
let descriptions = {};
/** @type {ReturnType<typeof computeDagLayout>|null} */
let layout = null;
/** @type {string|null} */
let selectedNodeId = null;

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
// Snapshot loading (mirrors the graph view, Issues #93 / #118)
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

async function loadSnapshot(source, label) {
  try {
    setStatus(`Loading ${label}…`);
    snapshot = typeof source === "string"
      ? await loadSnapshotFromUrl(source)
      : source;
    const tooltips = extractTooltips(snapshot);
    labels = tooltips.labels;
    descriptions = tooltips.descriptions;
    await applyFallbackTooltips();
    el.snapshotDetails?.removeAttribute?.("open");
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

function detailLevel() {
  const key = String(el.detailLevel?.value ?? "balanced");
  return DETAIL_LEVELS[key] ?? DETAIL_LEVELS.balanced;
}

function render() {
  if (!snapshot) return;
  setStatus("Aggregating network…");

  const { collapseThreshold, maxNodesPerColumn } = detailLevel();
  const model = buildAggregatedGraphModel(snapshot, { collapseThreshold });
  layout = computeDagLayout(model, {
    tooltips: { labels, descriptions },
    maxNodesPerColumn,
  });

  if (el.diagram) el.diagram.innerHTML = dagLayoutToSvgString(layout);
  if (el.legendBody) el.legendBody.innerHTML = dagLegendHtml();
  renderSummary(model);
  renderNodePicker();
  if (selectedNodeId) selectNode(selectedNodeId);

  setStatus(
    `${formatInteger(layout.nodes.length)} nodes · ${
      formatInteger(layout.edges.length)
    } links`,
    "good",
  );
}

function renderSummary(model) {
  if (!el.summaryLine || !layout) return;
  const meta = model?.meta ?? {};
  const families = model?.families?.length ?? 0;
  // State every reduction explicitly — a diagram that quietly drops most of
  // the network would read as "this is the whole network".
  el.summaryLine.textContent = [
    `${formatInteger(families)} observation families`,
    `${formatInteger(meta.keptNeuronCount ?? 0)} of ${
      formatInteger(meta.neuronCount ?? 0)
    } neurons reach the output`,
    `${formatInteger(meta.collapsedNeuronCount ?? 0)} folded as low impact`,
    `${formatInteger(meta.droppedNeuronCount ?? 0)} dead (no path to output)`,
    `${formatInteger(layout.meta.foldedNodeCount ?? 0)} folded to the top ${
      formatInteger(layout.meta.maxNodesPerColumn ?? 0)
    } per column`,
  ].join(" · ");
}

function renderNodePicker() {
  if (!el.nodePicker || !layout) return;
  const options = layout.nodes
    .slice()
    .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))
    .map((node) =>
      `<option value="${escapeHtml(node.id)}">${
        escapeHtml(node.label || node.id)
      } (impact ${node.impact.toFixed(3)})</option>`
    );
  el.nodePicker.innerHTML = `<option value="">Select a node…</option>${
    options.join("")
  }`;
  if (selectedNodeId) el.nodePicker.value = selectedNodeId;
}

/** Render the details panel for a node id, and highlight it in the diagram. */
function selectNode(nodeId) {
  if (!layout || !el.detailsBody) return;
  const node = layout.nodes.find((n) => n.id === nodeId);
  if (!node) return;
  selectedNodeId = nodeId;
  if (el.nodePicker) el.nodePicker.value = nodeId;

  for (const group of el.diagram?.querySelectorAll?.(".dagNode") ?? []) {
    const isSelected = group.getAttribute("data-node-id") === nodeId;
    group.classList.toggle("isSelected", isSelected);
  }

  const inbound = layout.edges.filter((e) => e.to === nodeId);
  const outbound = layout.edges.filter((e) => e.from === nodeId);

  const rows = [
    `<h3 class="detailsTitle">${escapeHtml(node.label || node.id)}</h3>`,
    `<dl class="detailsGrid">`,
    `<dt>Kind</dt><dd>${escapeHtml(node.kind)}</dd>`,
    `<dt>Column</dt><dd>${
      escapeHtml(layout.columns[node.column]?.label ?? node.column)
    }</dd>`,
    `<dt>Impact</dt><dd>${node.impact.toFixed(4)}</dd>`,
    `<dt>Share of column</dt><dd>${(node.columnShare * 100).toFixed(1)}%</dd>`,
    `<dt>Members</dt><dd>${formatInteger(node.memberCount)}</dd>`,
    `<dt>Links</dt><dd>${formatInteger(inbound.length)} in · ${
      formatInteger(outbound.length)
    } out</dd>`,
    `</dl>`,
  ];

  const members = node.members.slice(0, MAX_DETAIL_MEMBERS);
  if (members.length > 0) {
    rows.push(`<ul class="detailsMembers">`);
    for (const uuid of members) {
      const text = buildObservationTooltip({
        uuid,
        label: labels[uuid] ?? null,
        description: descriptions[uuid] ?? null,
      });
      rows.push(`<li>${escapeHtml(text || uuid)}</li>`);
    }
    rows.push(`</ul>`);
    if (node.memberCount > members.length) {
      rows.push(
        `<p class="detailsMore">…and ${
          formatInteger(node.memberCount - members.length)
        } more</p>`,
      );
    }
  }

  el.detailsBody.innerHTML = rows.join("");
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

el.diagram?.addEventListener?.("click", (event) => {
  const group = event.target?.closest?.(".dagNode");
  const nodeId = group?.getAttribute?.("data-node-id");
  if (nodeId) selectNode(nodeId);
});

el.nodePicker?.addEventListener?.("change", () => {
  const nodeId = el.nodePicker?.value ?? "";
  if (nodeId) selectNode(nodeId);
});

el.detailLevel?.addEventListener?.("change", () => {
  if (snapshot) render();
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

if (el.legendBody) el.legendBody.innerHTML = dagLegendHtml();
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
  setStatus("Ready — load a snapshot to render the network.");
}
