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

import { computeImpactBreakdownToOutputs } from "./impact_attribution.js";

let SNAPSHOT = null;
let synapses = [];
let neuronsByUuid = new Map();
let trace = []; // Array of neuron UUIDs
let uuidToLabel = {}; // "input-N" -> "human-name"
let uuidToDescription = {}; // "input-N" -> "Tooltip description"

let lastImpactBreakdown = null;
let lastImpactNeuronUuid = null;
let lastImpactNeuronImpact = null;
let lastImpactOutputUuid = null;
let lastImpactPathPage = 0;
const IMPACT_PATH_PAGE_SIZE = 200;

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
}

function renderImpactBreakdown(uuid, neuronType, neuronImpact) {
  if (!el.impactBreakdown) return;

  // Only show for non-output neurons; output neurons are the "end" of attribution.
  if (neuronType === "output") {
    el.impactBreakdown.innerHTML = "";
    return;
  }

  const outputs = Array.from(neuronsByUuid.values())
    .filter((n) => n?.type === "output" && typeof n.uuid === "string")
    .map((n) => n.uuid);

  if (outputs.length === 0) {
    el.impactBreakdown.innerHTML = "";
    return;
  }

  const breakdown = computeImpactBreakdownToOutputs({
    startUuid: uuid,
    synapses,
    outputUuids: outputs,
    neuronImpact: neuronImpact ?? null,
    collectPaths: true,
    maxDepth: 10,
    maxPaths: 2500,
    topPathsPerOutput: 3,
  });

  if (!breakdown.outputs || breakdown.outputs.length === 0) {
    el.impactBreakdown.innerHTML = "";
    return;
  }

  const title = "Impact → outputs";
  const note =
    "Heuristic allocation using |weight| products across forward paths. " +
    "This is shown to explain multi-path fan-out; it isn't a ground-truth per-synapse impact.";

  lastImpactBreakdown = breakdown;
  lastImpactNeuronUuid = uuid;
  lastImpactNeuronImpact = neuronImpact ?? null;
  lastImpactOutputUuid = null;
  lastImpactPathPage = 0;

  const headerHtml = `
    <div class="impactBreakdownHeader">
      <div class="impactBreakdownTitle">${escapeHtml(title)}</div>
      ${
    breakdown.truncated
      ? '<div class="impactBreakdownTruncated" title="Path enumeration hit a safety limit">truncated</div>'
      : ""
  }
    </div>
    <div class="impactBreakdownNote">${escapeHtml(note)}</div>
  `;

  const rows = breakdown.outputs.map((o) => {
    const allocated = o.allocatedImpact != null
      ? formatSig(o.allocatedImpact, 3)
      : "N/A";
    const sharePct = formatSig(o.share * 100, 3) + "%";
    const outLabel = truncateNeuronName(o.outputUuid);

    const pathsHtml = (o.topPaths ?? []).length > 0
      ? `
        <ul class="impactBreakdownPaths">
          ${
        (o.topPaths ?? []).map((p) => `
            <li title="Path score: product(|weight|)">
              <span class="impactPath">${
          escapeHtml(p.nodes.map(truncateUuid).join(" → "))
        }</span>
              <span class="impactPathScore">${
          escapeHtml(formatSig(p.score, 3))
        }</span>
            </li>
          `).join("")
      }
        </ul>
      `
      : "";

    return `
      <div class="impactBreakdownRow">
        <div class="impactBreakdownOut">${escapeHtml(outLabel)}</div>
        <div class="impactBreakdownStats">
          <span class="stat" title="Allocated impact to this output">${
      escapeHtml(allocated)
    }</span>
          <span class="stat" title="Share of this neuron's impact">${
      escapeHtml(sharePct)
    }</span>
          <span class="stat" title="Distinct acyclic forward paths considered">paths: ${
      escapeHtml(String(o.pathCount))
    }</span>
          <button class="impactBreakdownBtn" type="button" data-output="${
      escapeHtml(o.outputUuid)
    }" title="Inspect all paths and calculations">
            Inspect
          </button>
        </div>
      </div>
      ${pathsHtml}
    `;
  }).join("");

  el.impactBreakdown.innerHTML = headerHtml +
    `<div class="impactBreakdownList">${rows}</div>`;

  // Event delegation for the newly-rendered buttons.
  el.impactBreakdown.onclick = (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;
    const btn = target.closest(".impactBreakdownBtn");
    if (!btn) return;
    const outputUuid = btn.getAttribute("data-output");
    if (!outputUuid) return;
    openPathModal(outputUuid);
  };
}

function openPathModal(outputUuid) {
  if (!el.pathModal || !el.pathModalBody || !el.pathModalTitle) return;
  if (!lastImpactBreakdown) return;

  lastImpactOutputUuid = outputUuid;
  lastImpactPathPage = 0;

  el.pathModal.classList.add("isOpen");
  el.pathModal.setAttribute("aria-hidden", "false");
  renderPathModalPage();
}

function closePathModal() {
  if (!el.pathModal) return;
  el.pathModal.classList.remove("isOpen");
  el.pathModal.setAttribute("aria-hidden", "true");
}

function renderPathModalPage() {
  if (!el.pathModalBody || !el.pathModalTitle || !el.pathModalMore) return;
  if (!lastImpactBreakdown || !lastImpactOutputUuid) return;

  const out = (lastImpactBreakdown.outputs ?? []).find((o) =>
    o.outputUuid === lastImpactOutputUuid
  );
  if (!out) return;

  const paths = (out.paths ?? out.topPaths ?? []).slice().sort((a, b) =>
    (b.score ?? 0) - (a.score ?? 0)
  );

  const total = paths.length;
  const shown = Math.min(
    total,
    (lastImpactPathPage + 1) * IMPACT_PATH_PAGE_SIZE,
  );

  const neuronImpact = lastImpactNeuronImpact;
  const outputScore = out.score ?? 0;
  const totalScore = lastImpactBreakdown.totalScore ?? 0;
  const share = out.share ?? 0;
  const allocated = typeof neuronImpact === "number" && isFinite(neuronImpact)
    ? neuronImpact * share
    : null;

  el.pathModalTitle.textContent = `Impact path inspector: ${
    truncateUuid(lastImpactNeuronUuid ?? "")
  } → ${truncateUuid(lastImpactOutputUuid)}`;

  const eqAllocated = allocated != null
    ? `${formatSig(neuronImpact, 6)} × ${formatSig(share, 6)} = ${
      formatSig(allocated, 6)
    }`
    : "N/A";

  const header = `
    <dl class="modalKvp">
      <dt>Neuron</dt>
      <dd>${escapeHtml(lastImpactNeuronUuid ?? "N/A")}</dd>
      <dt>Output</dt>
      <dd>${escapeHtml(lastImpactOutputUuid)}</dd>
      <dt>Paths enumerated</dt>
      <dd>${escapeHtml(String(out.pathCount ?? total))}${
    lastImpactBreakdown.truncated
      ? ' <span class="impactBreakdownTruncated">truncated</span>'
      : ""
  }</dd>
      <dt>Output score</dt>
      <dd>${escapeHtml(formatSig(outputScore, 6))}</dd>
      <dt>Total score</dt>
      <dd>${escapeHtml(formatSig(totalScore, 6))}</dd>
      <dt>Share</dt>
      <dd>${escapeHtml(formatSig(share, 6))} (=${
    escapeHtml(formatSig(share * 100, 4))
  }%)</dd>
      <dt>Allocated impact</dt>
      <dd>${
    escapeHtml(allocated != null ? formatSig(allocated, 6) : "N/A")
  } <span class="pathEquation">(= impact × share: ${
    escapeHtml(eqAllocated)
  })</span></dd>
    </dl>
    <div class="impactBreakdownNote">
      Path score per path: <span class="pathEquation">∏ |weight|</span>. Output score: <span class="pathEquation">Σ (path score)</span>. Share: <span class="pathEquation">outputScore / totalScore</span>.
    </div>
  `;

  const items = paths.slice(0, shown).map((p, idx) => {
    const nodes = p.nodes ?? [];
    const steps = p.steps ?? [];
    const absWeights = steps.map((s) => Math.abs(s.weight));
    const recomputed = absWeights.reduce((acc, w) => acc * w, 1);
    const chain = nodes.map(truncateUuid).join(" → ");
    const weightStr = steps.map((s) => formatSig(s.weight, 6)).join(", ");
    const absStr = absWeights.map((w) => formatSig(w, 6)).join(" × ");
    const eq = absWeights.length > 0
      ? `${absStr} = ${formatSig(recomputed, 6)}`
      : `1 = ${formatSig(recomputed, 6)}`;

    return `
      <details class="pathItem">
        <summary>
          <span class="pathSummaryPath">${escapeHtml(chain)}</span>
          <span class="pathSummaryScore">${
      escapeHtml(formatSig(p.score, 6))
    }</span>
        </summary>
        <div class="pathDetails">
          <div>Weights (signed): <span class="pathEquation">${
      escapeHtml(weightStr || "N/A")
    }</span></div>
          <div>Score: <span class="pathEquation">${escapeHtml(eq)}</span></div>
          <div>Recorded score: <span class="pathEquation">${
      escapeHtml(formatSig(p.score, 6))
    }</span> (Δ=${escapeHtml(formatSig((p.score ?? 0) - recomputed, 6))})</div>
          <div class="impactBreakdownNote">Path #${
      escapeHtml(String(idx + 1))
    }</div>
        </div>
      </details>
    `;
  }).join("");

  el.pathModalBody.innerHTML = header + `<div class="pathList">${items}</div>`;

  // Update "show more" button.
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
    lastImpactPathPage += 1;
    renderPathModalPage();
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

  const enriched = inbound.map((syn) => {
    const impact = getNeuronImpact(syn.fromUuid);
    const mse = getMSE(syn.fromUuid);
    const contrib = getMeanContribution(syn.fromUuid, syn.toUuid);
    const alias = getAlias(syn.fromUuid);
    const isInput = syn.fromUuid.startsWith("input-");
    return { ...syn, impact, mse, contrib, alias, isInput };
  });

  const sortKey = el.synapseSort.value;
  enriched.sort((a, b) => {
    switch (sortKey) {
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
