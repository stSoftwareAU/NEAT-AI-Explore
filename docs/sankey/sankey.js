/**
 * Sankey contribution-flow view (Issue #526).
 *
 * A contrasting candidate to the layered DAG. It renders contribution *flow*
 * from observation families → hidden layers → output, with each band's width
 * proportional to the contribution that reaches the Score. The heavy lifting is
 * done off the DOM:
 *
 *   snapshot → buildAggregatedGraphModel (aggregate + collapse + layer + impact)
 *            → buildSankeyFlow (conserved back-to-front flow assignment)
 *            → this module (SVG geometry only)
 *
 * Keeping the maths in `docs/shared/sankey_flow.js` means the flow contract is
 * unit-tested (see `tests/sankey_view_test.ts`); a rendering-only failure is
 * caught by the side-by-side comparison against the DAG candidate (#522).
 */

import {
  decodeBase64UrlToUtf8,
  fetchSnapshotJson,
  isDangerousUrlScheme,
  normaliseSnapshotUrl,
  readSnapshotFile,
} from "../shared/snapshot_loader.js";
import {
  DEFAULT_SNAPSHOT_URL,
  SNAPSHOT_FALLBACK_URLS,
} from "../shared/config.js";
import { buildAggregatedGraphModel } from "../shared/aggregated_graph_model.js";
import {
  buildSankeyFlow,
  traceLinkFlow,
  traceNodeFlow,
} from "../shared/sankey_flow.js";
import {
  PHONE_MAX_WIDTH,
  sankeyLayoutForWidth,
} from "../shared/sankey_responsive.js";
import {
  computeSankeyGeometry,
  truncateLabel,
} from "../shared/sankey_layout.js";
import { createDebounce } from "../shared/debounce.js";
import {
  buildObservationTooltip,
  escapeHtml,
  extractTooltips,
} from "../shared/ui_helpers.js";
import { formatInteger } from "../shared/number_format.js";
import { synapseWeightColourCss } from "../shared/colour_maps.js";
import {
  attachTooltipDismissers,
  attachTooltipTrigger,
  createTooltipController,
} from "./tooltip_panel.js";
import {
  attachFoldPanelDismissers,
  attachFoldTrigger,
  createFoldPanelController,
} from "./fold_panel.js";
import { attachZoomControls, createZoomPanController } from "./zoom_pan.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Members listed in the details panel before the list is truncated. */
const MAX_DETAIL_MEMBERS = 40;

/** Settle time (ms) before a resize re-lays the diagram out. */
const RESIZE_DEBOUNCE_MS = 150;

// ---------------------------------------------------------------------------
// View state (Issue #537). Selection lives at module scope so it survives a
// re-render of the *same* snapshot, and is cleared when a new snapshot loads.
// ---------------------------------------------------------------------------

/** @type {ReturnType<typeof buildSankeyFlow>|null} */
let currentFlow = null;
/** @type {{ type: "node"|"link", id: string }|null} */
let selection = null;
/** @type {Record<string, string>} */
let labels = {};
/** @type {Record<string, string>} */
let descriptions = {};
/** The snapshot on screen, kept so a breakpoint change can re-lay it out. */
let currentSnapshot = null;
/** @type {"phone"|"desktop"|null} */
let activeBreakpoint = null;
/** Truncation length for the live layout — labels shorten on a phone. */
let labelMaxChars = 22;

/**
 * The layout constants for the live viewport width.
 *
 * A viewport that reports no usable width is a browser fault, not a phone, so
 * it is reported rather than silently rendering the desktop canvas (#3234).
 */
function currentLayout() {
  const width = Number(globalThis.innerWidth);
  if (!Number.isFinite(width) || width <= 0) {
    console.error(
      "Viewport width unavailable — falling back to the desktop Sankey layout.",
    );
    return sankeyLayoutForWidth(PHONE_MAX_WIDTH + 1);
  }
  return sankeyLayoutForWidth(width);
}

/** Create an SVG element with attributes. */
function svg(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function setStatus(text, isBad = false) {
  const el = document.getElementById("status");
  if (!el) return;
  el.textContent = text;
  el.className = isBad ? "status bad" : "status";
}

let tooltipController = null;

/**
 * The shared touch/keyboard tooltip panel (Issue #536).
 *
 * SVG `<title>` only renders on hover, so the panel is what makes the #521
 * observation summaries reachable on a phone. Created once, on first use.
 */
function tooltipPanel() {
  if (tooltipController) return tooltipController;
  const el = document.getElementById("tooltip");
  if (!el) {
    // Fail loud rather than silently dropping touch tooltips (Issue #3234).
    console.error(
      "Tooltip panel #tooltip is missing — touch tooltips are off.",
    );
    return null;
  }
  tooltipController = createTooltipController(el);
  attachTooltipDismissers(document, tooltipController);
  return tooltipController;
}

let foldController = null;

/**
 * The folded-tail inspector (Issue #538).
 *
 * The fold keeps the diagram readable but hides the thin/absent flows a viewer
 * hunting dead zones needs; this panel lists them. Created once, on first use.
 */
function foldPanel() {
  if (foldController) return foldController;
  try {
    foldController = createFoldPanelController(document);
  } catch (err) {
    // Fail loud rather than leaving folds silently uninspectable (Issue #3234).
    console.error("Fold panel unavailable:", err);
    return null;
  }
  attachFoldPanelDismissers(document, foldController);
  return foldController;
}

let zoomController = null;
let zoomControls = null;

/**
 * The pinch/drag/keyboard zoom controller (Issue #540).
 *
 * A phone viewport cannot show every band at a legible size at once, so the
 * viewer magnifies a region instead. Created once, on first render.
 */
function zoomPan() {
  if (zoomController) return zoomController;
  zoomController = createZoomPanController({
    onChange: () => zoomControls?.update(),
  });
  try {
    zoomControls = attachZoomControls(document, zoomController);
  } catch (err) {
    // Fail loud rather than shipping a diagram with no keyboard zoom route.
    console.error("Zoom controls unavailable:", err);
  }
  return zoomController;
}

/**
 * Point the zoom controller at a freshly rendered diagram.
 *
 * The published snapshot lays out as 33 layers, so on a phone the whole diagram
 * is an illegible strip: the narrow layout instead opens on one full-height
 * screenful of it, sized to the diagram pane, and pans from there. The desktop
 * keeps its `height: auto` fit-to-width view untouched.
 */
function attachZoom(svgEl, geometry, layout) {
  const content = {
    width: geometry.viewWidth,
    height: geometry.viewHeight,
  };
  if (!layout.isNarrow) {
    zoomPan().attach(svgEl, content);
    return;
  }
  const pane = document
    .querySelector(".diagramWrap")
    ?.getBoundingClientRect?.();
  if (!pane || !(pane.width > 0) || !(pane.height > 0)) {
    // Fail loud: without a measured pane the phone view silently reverts to
    // the illegible fit-to-width strip (Issue #3234).
    console.error(
      "Diagram pane could not be measured — falling back to the fit-to-width view.",
    );
    zoomPan().attach(svgEl, content);
    return;
  }
  zoomPan().attach(svgEl, content, {
    aspect: pane.width / pane.height,
    initial: "fit-height",
  });
}

function nodeColour(node) {
  if (node.isOutput) return "var(--node-output)";
  if (node.kind === "family") return "var(--node-family)";
  if (node.kind === "collapsed" || node.kind === "other") {
    return "var(--node-collapsed)";
  }
  return "var(--node-neuron)";
}

/** Truncate a label to the live layout's width budget. */
function truncate(text, max = labelMaxChars) {
  return truncateLabel(text, max);
}

/**
 * Draw the conserved Sankey for a set of responsive layout constants.
 *
 * Geometry lives in `shared/sankey_layout.js` so the layout decisions this
 * renderer makes at a phone width — the per-layer budget, the band floor and
 * the label-visibility threshold — are asserted in CI; this function only turns
 * that geometry into SVG.
 */
function render(flow, layout) {
  currentFlow = flow;
  labelMaxChars = layout.labelMaxChars;
  const wrap = document.getElementById("diagram");
  const meta = document.getElementById("meta");
  if (!wrap) return;
  wrap.textContent = "";
  // A panel left open would describe a node that no longer exists.
  const tip = tooltipPanel();
  tip?.hide();
  const fold = foldPanel();
  fold?.close();

  const geometry = computeSankeyGeometry(flow, layout);
  if (geometry.nodes.length === 0) {
    setStatus("No contribution flow to render for this snapshot.", true);
    return;
  }

  const svgEl = svg("svg", {
    class: "sankey",
    viewBox: `0 0 ${geometry.viewWidth} ${geometry.viewHeight}`,
    preserveAspectRatio: "xMidYMid meet",
    role: "img",
    "aria-label":
      "Sankey diagram of contribution flow from observation families to the output score",
  });

  const labelById = new Map(
    geometry.nodes.map((geom) => [geom.id, geom.node.label || geom.id]),
  );

  // Draw links first so nodes sit on top.
  for (const band of geometry.links) {
    const path = svg("path", {
      class: "sankeyLink",
      "data-link-id": band.id,
      d: band.path,
      stroke: synapseWeightColourCss(band.link.weight),
      "stroke-width": band.thickness,
    });
    const pct = flow.totalScore > 0
      ? ((band.link.value / flow.totalScore) * 100).toFixed(1)
      : "0.0";
    const titleText = `${labelFor(labelById, band.link.source)} → ${
      labelFor(labelById, band.link.target)
    }\n${pct}% of the Score`;
    const title = svg("title");
    title.textContent = titleText;
    path.appendChild(title);
    // Same string on both paths — hover renders <title>, touch renders the panel.
    if (tip) attachTooltipTrigger(path, titleText, tip);
    svgEl.appendChild(path);
  }

  // Nodes.
  for (const geom of geometry.nodes) {
    const node = geom.node;
    const group = svg("g", {
      class: "sankeyNode",
      "data-node-id": node.id,
      tabindex: "0",
      role: "listitem",
      "aria-label": node.tooltip.replace(/\n/g, "; "),
    });
    const rect = svg("rect", {
      class: "sankeyNodeRect",
      x: geom.x,
      y: geom.y,
      width: geom.width,
      height: geom.h,
      rx: 3,
      fill: nodeColour(node),
    });
    const title = svg("title");
    title.textContent = node.tooltip;
    group.appendChild(rect);
    group.appendChild(title);
    if (tip) attachTooltipTrigger(group, node.tooltip, tip);
    // A folded node opens its member list — the fold stays inspectable (#538).
    if (node.kind === "other") {
      group.setAttribute("class", "sankeyNode isFolded");
      if (fold) {
        attachFoldTrigger(group, node, fold, { totalScore: flow.totalScore });
      }
    }

    if (geom.showLabel) {
      const label = svg("text", {
        class: "sankeyNodeLabel",
        x: geom.labelX,
        y: geom.labelY,
        "text-anchor": geom.labelAnchor,
      });
      label.textContent = geom.labelText;
      group.appendChild(label);
    }
    svgEl.appendChild(group);
  }

  wrap.appendChild(svgEl);
  attachZoom(svgEl, geometry, layout);

  if (meta) renderMeta(meta, flow);
  // Re-populate the picker and re-apply any live selection so a re-render of the
  // same snapshot keeps the traced path highlighted (Issue #537).
  renderNodePicker();
  applySelection();
  setStatus(
    `Rendered ${flow.meta.nodeCount} nodes and ${flow.meta.linkCount} flows ` +
      `(from ${flow.meta.rawNeuronCount} neurons, ${flow.meta.rawSynapseCount} synapses).`,
  );
}

function labelFor(labelById, id) {
  return truncate(labelById.get(id) || id, 30);
}

function renderMeta(el, flow) {
  el.textContent = "";
  const parts = [
    `Score total: ${flow.totalScore.toPrecision(3)}`,
    `${flow.meta.collapsedNeuronCount} low-impact neurons collapsed`,
  ];
  if (!flow.meta.outputSharesComputed) {
    parts.push("output-share attribution skipped (network too large)");
  }
  const span = document.createElement("span");
  span.textContent = parts.join(" · ");
  el.appendChild(span);
  if (!flow.meta.withinBudget) {
    const over = [];
    if (flow.meta.nodeCount > flow.meta.maxNodes) {
      over.push(`${flow.meta.nodeCount}/${flow.meta.maxNodes} nodes`);
    }
    if (flow.meta.linkCount > flow.meta.maxLinks) {
      over.push(`${flow.meta.linkCount}/${flow.meta.maxLinks} flows`);
    }
    const warn = document.createElement("span");
    warn.className = "warn";
    warn.textContent = ` · diagram exceeds the readability budget (${
      over.join(", ")
    })`;
    el.appendChild(warn);
  }
}

// ---------------------------------------------------------------------------
// Selection & path tracing (Issue #537)
//
// The DOM-free traversal lives in `shared/sankey_flow.js`; this section only
// turns a selection into CSS classes and a details panel. That split keeps the
// path-tracing logic unit-tested and this file a thin DOM adapter.
// ---------------------------------------------------------------------------

/** Contribution of `value` as a percentage of the Score, one decimal place. */
function pctOfScore(value) {
  return currentFlow && currentFlow.totalScore > 0
    ? ((value / currentFlow.totalScore) * 100).toFixed(1)
    : "0.0";
}

/** The trace for the current selection, or null when nothing is selected. */
function currentTrace() {
  if (!currentFlow || !selection) return null;
  return selection.type === "node"
    ? traceNodeFlow(currentFlow, selection.id)
    : traceLinkFlow(currentFlow, selection.id);
}

/**
 * Toggle highlight/dim classes across the diagram for the live selection.
 * With no selection every band and node returns to its neutral state.
 */
function applySelection() {
  const wrap = document.getElementById("diagram");
  const svgEl = wrap?.querySelector("svg.sankey");
  if (!svgEl) return;
  const trace = currentTrace();
  const linkSet = trace ? new Set(trace.linkIds) : null;
  const nodeSet = trace ? new Set(trace.nodeIds) : null;

  for (const path of svgEl.querySelectorAll(".sankeyLink")) {
    const on = !!linkSet && linkSet.has(path.getAttribute("data-link-id"));
    path.classList.toggle("isHighlighted", !!trace && on);
    path.classList.toggle("isDimmed", !!trace && !on);
  }
  for (const group of svgEl.querySelectorAll(".sankeyNode")) {
    const id = group.getAttribute("data-node-id");
    const onPath = !!nodeSet && nodeSet.has(id);
    const isSelected = selection?.type === "node" && selection.id === id;
    group.classList.toggle("isSelected", !!trace && isSelected);
    group.classList.toggle("isOnPath", !!trace && onPath && !isSelected);
    group.classList.toggle("isDimmed", !!trace && !onPath);
  }
  svgEl.classList.toggle("hasSelection", !!trace);
  renderDetails();
}

/** Select a node by id and trace its full flow to the output. */
function selectNode(nodeId) {
  if (!currentFlow || !nodeId) return;
  if (!currentFlow.nodes.some((n) => n.id === nodeId)) return;
  selection = { type: "node", id: nodeId };
  const picker = document.getElementById("nodePicker");
  if (picker) picker.value = nodeId;
  applySelection();
}

/** Select a single band and highlight it with both its endpoints. */
function selectLink(linkId) {
  if (!currentFlow || !linkId) return;
  if (!currentFlow.links.some((l) => l.id === linkId)) return;
  selection = { type: "link", id: linkId };
  const picker = document.getElementById("nodePicker");
  if (picker) picker.value = "";
  applySelection();
}

/** Clear the selection and restore every band/node to its neutral state. */
function clearSelection() {
  if (!selection) return;
  selection = null;
  const picker = document.getElementById("nodePicker");
  if (picker) picker.value = "";
  applySelection();
}

/** Populate the node picker from the current flow, ranked by contribution. */
function renderNodePicker() {
  const picker = document.getElementById("nodePicker");
  if (!picker || !currentFlow) return;
  const options = currentFlow.nodes
    .filter((n) => n.value > 0)
    .slice()
    .sort((a, b) => b.value - a.value || (a.id < b.id ? -1 : 1))
    .map((node) =>
      `<option value="${escapeHtml(node.id)}">${
        escapeHtml(node.label || node.id)
      } (${pctOfScore(node.value)}% of Score)</option>`
    );
  picker.innerHTML = `<option value="">Select a family or neuron…</option>${
    options.join("")
  }`;
  picker.value = selection?.type === "node" ? selection.id : "";
}

/** Render the details panel for the current node/band selection. */
function renderDetails() {
  const body = document.getElementById("detailsBody");
  if (!body) return;
  if (!currentFlow || !selection) {
    body.textContent =
      "Select a family or neuron (tap it, or focus it and press Enter) to " +
      "trace its flow through to the Score.";
    return;
  }
  body.innerHTML = selection.type === "link"
    ? renderLinkDetails()
    : renderNodeDetails();
}

function renderNodeDetails() {
  const node = currentFlow.nodes.find((n) => n.id === selection.id);
  if (!node) return "This node is no longer in the diagram.";
  const kindLabel = {
    family: "Observation family",
    neuron: "Hidden neuron",
    other: "Folded pathways",
    collapsed: "Collapsed (low impact)",
  }[node.kind] ?? node.kind;
  const displayKind = node.isOutput ? "Output (Score)" : kindLabel;
  const memberCount = node.memberCount ?? 0;

  const rows = [
    `<h3 class="detailsTitle">${escapeHtml(node.label || node.id)}</h3>`,
    `<dl class="detailsGrid">`,
    `<dt>Kind</dt><dd>${escapeHtml(displayKind)}</dd>`,
    `<dt>Throughput</dt><dd>${node.value.toPrecision(3)}</dd>`,
    `<dt>Share of Score</dt><dd>${pctOfScore(node.value)}%</dd>`,
    `<dt>Members</dt><dd>${formatInteger(memberCount)} observation${
      memberCount === 1 ? "" : "s"
    }</dd>`,
    `</dl>`,
  ];

  // For a family, list the #521 observation summaries so troubleshooting a
  // traced flow shows *which* observations drive it.
  const members = Array.isArray(node.members)
    ? node.members.slice(0, MAX_DETAIL_MEMBERS)
    : [];
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
    const rest = memberCount - members.length;
    if (rest > 0) {
      rows.push(`<p class="detailsMore">…and ${formatInteger(rest)} more</p>`);
    }
  }
  return rows.join("");
}

function renderLinkDetails() {
  const link = currentFlow.links.find((l) => l.id === selection.id);
  if (!link) return "This flow is no longer in the diagram.";
  const source = currentFlow.nodes.find((n) => n.id === link.source);
  const target = currentFlow.nodes.find((n) => n.id === link.target);
  return [
    `<h3 class="detailsTitle">${escapeHtml(source?.label || link.source)} → ${
      escapeHtml(target?.label || link.target)
    }</h3>`,
    `<dl class="detailsGrid">`,
    `<dt>Flow</dt><dd>${link.value.toPrecision(3)}</dd>`,
    `<dt>Share of Score</dt><dd>${pctOfScore(link.value)}%</dd>`,
    `</dl>`,
  ].join("");
}

/** Wire click/tap, keyboard, picker and Escape handlers for selection. */
function wireSelectionControls() {
  const wrap = document.getElementById("diagram");
  const picker = document.getElementById("nodePicker");

  wrap?.addEventListener("click", (event) => {
    // A drag that panned the diagram is not a tap — it must not clear or
    // change the selection when the finger lifts (Issue #540).
    if (zoomController?.consumePan()) return;
    const nodeGroup = event.target?.closest?.(".sankeyNode");
    if (nodeGroup) {
      selectNode(nodeGroup.getAttribute("data-node-id"));
      return;
    }
    const link = event.target?.closest?.(".sankeyLink");
    if (link) {
      selectLink(link.getAttribute("data-link-id"));
      return;
    }
    // Tapping the diagram background clears the selection (tap-away).
    clearSelection();
  });

  wrap?.addEventListener("keydown", (event) => {
    if (
      event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar"
    ) {
      return;
    }
    const nodeGroup = event.target?.closest?.(".sankeyNode");
    if (nodeGroup) {
      event.preventDefault();
      selectNode(nodeGroup.getAttribute("data-node-id"));
    }
  });

  picker?.addEventListener("change", () => {
    const id = picker.value ?? "";
    if (id) selectNode(id);
    else clearSelection();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") clearSelection();
  });
}

/**
 * Build the aggregated model, derive the Sankey flow for the live breakpoint,
 * and render it.
 *
 * The per-layer fold budget is part of the responsive choice: a phone keeps
 * half as many nodes per layer, so each surviving band is roughly twice as tall
 * and its label clears the visibility threshold (Issue #540).
 */
function renderSnapshot(snapshot, { keepSelection = false } = {}) {
  const model = buildAggregatedGraphModel(snapshot);
  const tips = extractTooltips(snapshot);
  labels = tips.labels;
  descriptions = tips.descriptions;
  if (!keepSelection) selection = null;
  const layout = currentLayout();
  activeBreakpoint = layout.isNarrow ? "phone" : "desktop";
  const flow = buildSankeyFlow(model, {
    labels,
    descriptions,
    maxNodesPerLayer: layout.maxNodesPerLayer,
  });
  // A different fold budget folds different nodes away, so a kept selection
  // may no longer exist in the new diagram.
  if (selection) {
    const list = selection.type === "node" ? flow.nodes : flow.links;
    if (!list.some((item) => item.id === selection.id)) selection = null;
  }
  render(flow, layout);
}

/** Load a new snapshot: a new snapshot invalidates any prior selection (#537). */
function showSnapshot(snapshot) {
  currentSnapshot = snapshot;
  renderSnapshot(snapshot);
}

/**
 * Re-lay the diagram out when the viewport crosses the phone breakpoint, so a
 * rotation moves between the phone and desktop layouts rather than scaling one
 * of them down.
 */
function wireBreakpointRerender() {
  const debounced = createDebounce(() => {
    if (!currentSnapshot) return;
    const next = currentLayout().isNarrow ? "phone" : "desktop";
    if (next === activeBreakpoint) return;
    renderSnapshot(currentSnapshot, { keepSelection: true });
  }, RESIZE_DEBOUNCE_MS);
  globalThis.addEventListener("resize", () => debounced.call());
  globalThis.addEventListener("orientationchange", () => debounced.call());
}

/** Resolve the snapshot URL from query parameters (mirrors the trace app). */
function resolveSnapshotUrl(params) {
  const b64 = params.get("snapshotUrlB64");
  if (b64) {
    const decoded = decodeBase64UrlToUtf8(b64);
    if (isDangerousUrlScheme(decoded)) {
      throw new Error("Refusing to load a dangerous URL scheme.");
    }
    return normaliseSnapshotUrl(decoded);
  }
  const raw = params.get("snapshotUrl") ?? params.get("file");
  if (raw) {
    if (isDangerousUrlScheme(raw)) {
      throw new Error("Refusing to load a dangerous URL scheme.");
    }
    return normaliseSnapshotUrl(raw);
  }
  return null;
}

async function loadFromUrl(url) {
  const candidates = [url, ...SNAPSHOT_FALLBACK_URLS].filter(Boolean);
  let lastError = null;
  for (const candidate of candidates) {
    try {
      setStatus(`Loading ${candidate}…`);
      const snapshot = await fetchSnapshotJson(candidate);
      showSnapshot(snapshot);
      return;
    } catch (err) {
      lastError = err;
    }
  }
  // Fail loud rather than leaving a blank diagram (Issue #3234).
  setStatus(
    `Failed to load snapshot: ${lastError?.message ?? "unknown error"}`,
    true,
  );
}

function wireControls() {
  const fetchBtn = document.getElementById("fetchBtn");
  const fetchUrl = document.getElementById("fetchUrl");
  const fileBtn = document.getElementById("fileBtn");
  const fileInput = document.getElementById("fileInput");

  fetchBtn?.addEventListener("click", () => {
    const value = (fetchUrl?.value ?? "").trim();
    loadFromUrl(value || DEFAULT_SNAPSHOT_URL);
  });
  fileBtn?.addEventListener("click", () => fileInput?.click());
  fileInput?.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      setStatus(`Reading ${file.name}…`);
      const snapshot = await readSnapshotFile(file);
      showSnapshot(snapshot);
    } catch (err) {
      setStatus(`Failed to read file: ${err?.message ?? err}`, true);
    }
  });
}

async function main() {
  wireControls();
  wireSelectionControls();
  wireBreakpointRerender();
  renderDetails();
  const params = new URLSearchParams(location.search);

  // pa11y and offline previews open the page without a network fetch.
  if (params.get("noAutoLoad") === "1") {
    setStatus("Load a snapshot to render the contribution flow.");
    return;
  }

  let url = null;
  try {
    url = resolveSnapshotUrl(params);
  } catch (err) {
    setStatus(err?.message ?? String(err), true);
    return;
  }
  await loadFromUrl(url ?? DEFAULT_SNAPSHOT_URL);
}

main();
