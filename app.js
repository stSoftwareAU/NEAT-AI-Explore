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
  "Mean Activation": "Average output value across all samples",
  "Activation Range": "Minimum and maximum activation values observed",
  "MAE": "Mean Absolute Error - used in focus neuron ranking",
  "MSE": "Mean Squared Error - matches production creature scoring",
  "Samples": "Number of observations recorded for this neuron",
  "Max Recon Δ":
    "Maximum reconstruction delta - largest difference between recorded activation and recomputed activation from inputs. High values suggest recording or squash function issues.",
};

const el = {
  fetchUrl: document.getElementById("fetchUrl"),
  fetchBtn: document.getElementById("fetchBtn"),
  fileInput: document.getElementById("fileInput"),
  fileBtn: document.getElementById("fileBtn"),
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
// Input labels and descriptions (Tooltips.json)
// ============================================================================

async function loadInputLabels() {
  try {
    const res = await fetch("./Tooltips.json", { cache: "no-store" });
    if (!res.ok) return;
    const tooltipsByUuid = await res.json();

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
    console.log(`Loaded ${Object.keys(uuidToLabel).length} input labels`);
  } catch (e) {
    console.warn("Could not load Tooltips.json:", e.message);
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

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
    const obj = typeof source === "string" ? await fetchJson(source) : source;
    SNAPSHOT = obj;
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

  if (alias) {
    el.currentNeuronTitle.innerHTML =
      `<span class="aliasName" title="${desc ? escapeHtml(desc) : ""}">${
        escapeHtml(alias)
      }</span>` +
      `<span class="uuidSmall">${escapeHtml(uuid)}</span>`;
  } else {
    el.currentNeuronTitle.textContent = uuid;
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
  props.forEach(([label, value, cls]) => {
    const dt = document.createElement("dt");
    dt.textContent = label;
    if (TOOLTIPS[label]) {
      dt.title = TOOLTIPS[label];
      dt.classList.add("hasTooltip");
    }
    const dd = document.createElement("dd");
    dd.textContent = value;
    if (cls) dd.className = cls;
    el.neuronProps.appendChild(dt);
    el.neuronProps.appendChild(dd);
  });

  renderImpactBreakdown(uuid, n.type, impact);
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

function renderImpactBreakdown(uuid, neuronType, neuronImpact) {
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
// Event Listeners
// ============================================================================

el.fetchBtn.onclick = () => {
  const url = el.fetchUrl.value.trim() || "./snapshot.json";
  loadSnapshot(url, url);
};

el.fileBtn.onclick = () => el.fileInput.click();

el.fileInput.onchange = async () => {
  const file = el.fileInput.files?.[0];
  if (!file) return;
  try {
    setStatus(`Reading ${file.name}...`);
    const text = await file.text();
    const obj = JSON.parse(text);
    await loadSnapshot(obj, file.name);
  } catch (e) {
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

loadInputLabels().then(() => {
  const params = new URLSearchParams(window.location.search);
  const fileParam = params.get("file");
  if (fileParam) {
    el.fetchUrl.value = fileParam;
    loadSnapshot(fileParam, fileParam);
  } else {
    setStatus("Enter URL or browse for a snapshot JSON");
  }
});
