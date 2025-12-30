/**
 * NEAT-AI Explore - Starfield view (Issue #25)
 *
 * A fun, intuitive 3D visualisation of a full creature graph. Each neuron is a
 * "star" whose colour/size encodes structural information, and whose glow
 * highlights "CT-scan style" problems (non-finite values, saturation, heavy
 * tails, suspiciously low impacts).
 *
 * Implementation notes:
 * - Raw WebGL (no external deps) for a true 3D feel.
 * - Standalone loader controls (Fetch URL + Browse file + progress + theme).
 *
 * Last updated: 30-Dec-2025
 */

import {
  fetchSnapshotJson,
  readSnapshotFile,
} from "../shared/snapshot_loader.js";
import { initThemeMode } from "../shared/theme.js";
import { hash32, neuronColourRgb01, u32ToU01 } from "../shared/colour_maps.js";
import { computeInboundSynapseImpactAllocation } from "../impact_attribution.js";

const DEFAULT_SNAPSHOT_URL =
  "https://stsoftwareau.github.io/NEAT-AI-Snapshot/snapshot.json.gz";

// Starfield layout settings (tune for intuition > mathematical correctness).
const FOCUS_MAX_DEPTH = 5;
const FOCUS_RING_STEP = 30; // world units per graph hop away from focus
const FOCUS_FAR_RADIUS = 240; // unreachable / very far nodes
const UPSTREAM_MAX_DEPTH = 4; // hops shown in Paths mode (focused neuron -> upstream)

const el = {
  fetchUrl: document.getElementById("fetchUrl"),
  fetchBtn: document.getElementById("fetchBtn"),
  fileInput: document.getElementById("fileInput"),
  fileBtn: document.getElementById("fileBtn"),
  progressContainer: document.getElementById("progressContainer"),
  progressBar: document.getElementById("progressBar"),
  status: document.getElementById("status"),
  canvas: document.getElementById("glCanvas"),
  labelOverlay: document.getElementById("labelOverlay"),
  hud: document.getElementById("hud"),
  focusBadge: document.getElementById("focusBadge"),
  modeToggle: document.getElementById("modeToggle"),
};

function setStatus(msg, kind = "") {
  if (!el.status) return;
  el.status.textContent = String(msg ?? "");
  el.status.className = "statusInline " + kind;
}

function showProgress(indeterminate = false) {
  if (!el.progressContainer || !el.progressBar) return;
  el.progressContainer.style.display = "";
  el.progressBar.style.width = indeterminate ? "" : "0%";
  if (indeterminate) el.progressBar.classList.add("indeterminate");
  else el.progressBar.classList.remove("indeterminate");
}

function updateProgress(percent) {
  if (!el.progressBar) return;
  el.progressBar.classList.remove("indeterminate");
  el.progressBar.style.width = `${Math.min(100, Math.max(0, percent))}%`;
}

function hideProgress() {
  if (!el.progressContainer) return;
  el.progressContainer.style.display = "none";
}

// ============================================================================
// Snapshot parsing (minimal normalisation)
// ============================================================================

function normaliseCreature(snapshot) {
  const creature = snapshot?.creature ?? snapshot?.creatureJson;
  if (!creature) throw new Error("No creature in snapshot");

  const rawNeurons = Array.isArray(creature.neurons) ? creature.neurons : [];
  const rawSynapses = Array.isArray(creature.synapses) ? creature.synapses : [];

  const neuronsByUuid = new Map(rawNeurons.map((n) => [n.uuid, n]));

  const synapses = rawSynapses.map((s) => {
    const fromUuid = s.fromUuid ?? s.fromUUID ?? s.from_uuid;
    const toUuid = s.toUuid ?? s.toUUID ?? s.to_uuid;
    const weight = s.weight;
    if (!fromUuid || !toUuid || typeof weight !== "number") return null;
    return { fromUuid, toUuid, weight };
  }).filter(Boolean);

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

  return { creature, neuronsByUuid, synapses };
}

function getImpacts(snapshot) {
  const derived = snapshot?.derived;
  return derived?.impactsByNeuronUuid ?? derived?.impacts_by_neuron_uuid ?? {};
}

function getNeuronStats(snapshot, uuid) {
  return snapshot?.recording?.neurons?.[uuid]?.stats ?? null;
}

function getNeuronType(neuronsByUuid, uuid) {
  if (uuid?.startsWith?.("input-")) return "input";
  return String(neuronsByUuid.get(uuid)?.type ?? "hidden");
}

function getNeuronSquash(neuronsByUuid, uuid) {
  const n = neuronsByUuid.get(uuid);
  return String(n?.squash ?? "IDENTITY");
}

function getNeuronBias(neuronsByUuid, uuid) {
  const n = neuronsByUuid.get(uuid);
  return typeof n?.bias === "number" ? n.bias : null;
}

// ============================================================================
// Aliases / descriptions (from snapshot.tooltips)
// ============================================================================

let uuidToLabel = {};
let uuidToDescription = {};

function loadLabelsFromSnapshot(snapshot) {
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
      uuidToLabel[uuid] = label.trim();
    }
    if (typeof description === "string" && description.trim().length > 0) {
      uuidToDescription[uuid] = description.trim();
    }
  }
}

function getAlias(uuid) {
  return uuidToLabel[uuid] ?? null;
}

function getDescription(uuid) {
  return uuidToDescription[uuid] ?? null;
}

function displayName(uuid) {
  const a = getAlias(uuid);
  return a ? a : uuid;
}

function shortUuid(uuid) {
  const s = String(uuid ?? "");
  if (s.length <= 8) return s;
  return s.slice(-8);
}

function labelText(uuid) {
  return getAlias(uuid) ?? shortUuid(uuid);
}

// ============================================================================
// Risk signals ("CT scan") - lightweight, sample-based
// ============================================================================

function isFiniteNumber(x) {
  return typeof x === "number" && Number.isFinite(x);
}

function sampleEvenly(arr, maxN) {
  if (!Array.isArray(arr) || arr.length === 0) return [];
  const take = Math.min(arr.length, Math.max(8, Math.floor(maxN ?? 512)));
  if (take >= arr.length) return arr.slice();
  const step = arr.length / take;
  const out = [];
  for (let i = 0; i < take; i++) {
    const idx = Math.min(arr.length - 1, Math.floor(i * step));
    out.push(arr[idx]);
  }
  return out;
}

function nonFiniteCounts(rec) {
  const out = { activation: 0, value: 0, errors: 0 };
  const act = sampleEvenly(rec?.activation, 1024);
  const val = sampleEvenly(rec?.value, 1024);
  const err = Array.isArray(rec?.errors) ? rec.errors : [];

  for (const v of act) if (!isFiniteNumber(v)) out.activation += 1;
  for (const v of val) if (!isFiniteNumber(v)) out.value += 1;

  // Scan a capped subset of errors to avoid quadratic blow-ups.
  const errRows = sampleEvenly(err, 256);
  for (const row of errRows) {
    if (!Array.isArray(row)) continue;
    const vals = sampleEvenly(row, 64);
    for (const e of vals) if (!isFiniteNumber(e)) out.errors += 1;
  }

  return out;
}

function saturationStats(type, squash, rec) {
  // Heuristic only: use recorded activation series to approximate saturation /
  // dead zones. This is deliberately cheap and robust to schema drift.
  const t = String(type ?? "").toLowerCase();
  if (t === "input") return { fracDead: 0, fracClamped: 0 };

  const s = String(squash ?? "").toUpperCase();
  const seriesRaw = rec?.activation ?? rec?.value ?? null;
  const series = sampleEvenly(seriesRaw, 1024);
  if (!Array.isArray(series) || series.length < 8) {
    return { fracDead: 0, fracClamped: 0 };
  }

  let n = 0;
  let dead = 0;
  let clamped = 0;
  for (const v of series) {
    if (!isFiniteNumber(v)) continue;
    n += 1;
    if (s.includes("RELU") || s.includes("LEAKY")) {
      if (Math.abs(v) < 1e-6) dead += 1;
    }
    if (s.includes("TANH") || s.includes("HARD_TANH")) {
      if (Math.abs(v) > 0.99) clamped += 1;
    }
    if (s.includes("SIGMOID") || s.includes("LOGISTIC")) {
      if (v < 0.01 || v > 0.99) clamped += 1;
    }
    if (s.includes("STEP") || s.includes("BIPOLAR")) {
      // Discrete behaviour tends to saturate by definition.
      if (Math.abs(v) > 0.99 || Math.abs(v) < 1e-6) clamped += 1;
    }
  }
  if (n <= 0) return { fracDead: 0, fracClamped: 0 };
  return { fracDead: dead / n, fracClamped: clamped / n };
}

function errorTailStats(rec) {
  const err = Array.isArray(rec?.errors) ? rec.errors : null;
  if (!err || err.length < 8) return { top1Share: 0, topKShare: 0 };

  const rows = sampleEvenly(err, 512);
  /** @type {number[]} */
  const contrib = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length === 0) {
      contrib.push(0);
      continue;
    }
    const vals = sampleEvenly(row, 64);
    let sum = 0;
    let n = 0;
    for (const e of vals) {
      if (!isFiniteNumber(e)) continue;
      sum += e * e;
      n += 1;
    }
    contrib.push(n > 0 ? sum / n : 0);
  }

  let total = 0;
  for (const v of contrib) total += v;
  if (total <= 0) return { top1Share: 0, topKShare: 0 };

  // Top-k shares (k=8) by contribution.
  const sorted = contrib.slice().sort((a, b) => b - a);
  const top1Share = (sorted[0] ?? 0) / total;
  let topKSum = 0;
  for (let i = 0; i < Math.min(8, sorted.length); i++) topKSum += sorted[i];
  const topKShare = topKSum / total;
  return { top1Share, topKShare };
}

function computeRisk({
  impact,
  nonFinite,
  sat,
  tail,
}) {
  /** @type {{ score: number, reasons: string[] }} */
  const out = { score: 0, reasons: [] };

  if (typeof impact === "number" && impact >= 0 && impact < 1e-8) {
    out.score += 0.55;
    out.reasons.push("Impact < 1e-8 (suspicious / prunable?)");
  }

  const nfTotal = (nonFinite?.activation ?? 0) + (nonFinite?.value ?? 0) +
    (nonFinite?.errors ?? 0);
  if (nfTotal > 0) {
    out.score += 0.9;
    out.reasons.push("Non-finite values detected (NaN/Inf)");
  }

  if ((sat?.fracDead ?? 0) > 0.7) {
    out.score += 0.35;
    out.reasons.push("Dead zone high (many activations near 0)");
  }
  if ((sat?.fracClamped ?? 0) > 0.7) {
    out.score += 0.35;
    out.reasons.push("Saturation high (many activations near extrema)");
  }

  if ((tail?.top1Share ?? 0) > 0.25 || (tail?.topKShare ?? 0) > 0.75) {
    out.score += 0.4;
    out.reasons.push("Error heavy-tail (few observations dominate)");
  }

  out.score = Math.min(1, Math.max(0, out.score));
  return out;
}

// ============================================================================
// Layout (focus-centric, graph-informed, stable jitter)
// ============================================================================

function buildAdjacency(neuronsByUuid, synapses) {
  /** @type {Map<string, Set<string>>} */
  const adj = new Map();
  /** @type {Map<string, { weight: number, meanContribution: number|null }>} */
  const edgeByDir = new Map();

  for (const uuid of neuronsByUuid.keys()) {
    adj.set(uuid, new Set());
  }

  for (const s of synapses) {
    if (!adj.has(s.fromUuid)) adj.set(s.fromUuid, new Set());
    if (!adj.has(s.toUuid)) adj.set(s.toUuid, new Set());
    // Undirected adjacency for "directly linked" neighbourhood exploration.
    adj.get(s.fromUuid).add(s.toUuid);
    adj.get(s.toUuid).add(s.fromUuid);
    edgeByDir.set(`${s.fromUuid}→${s.toUuid}`, {
      weight: s.weight,
      meanContribution: null,
    });
  }

  return { adj, edgeByDir };
}

function buildInboundAdjacency(neuronsByUuid, synapses) {
  /** @type {Map<string, Set<string>>} */
  const inbound = new Map();
  for (const uuid of neuronsByUuid.keys()) inbound.set(uuid, new Set());
  for (const s of synapses) {
    if (!inbound.has(s.toUuid)) inbound.set(s.toUuid, new Set());
    inbound.get(s.toUuid).add(s.fromUuid);
  }
  return inbound;
}

function computeInboundDistancesFromFocus(inboundAdj, focusUuid, maxDepth) {
  /** @type {Map<string, number>} */
  const dist = new Map();
  /** @type {string[]} */
  const q = [];
  if (!focusUuid || !inboundAdj?.has?.(focusUuid)) return dist;
  dist.set(focusUuid, 0);
  q.push(focusUuid);
  while (q.length) {
    const u = q.shift();
    const d = dist.get(u) ?? 0;
    if (d >= (maxDepth ?? 0)) continue;
    const ins = inboundAdj.get(u) ?? new Set();
    for (const v of ins) {
      if (!dist.has(v)) {
        dist.set(v, d + 1);
        q.push(v);
      }
    }
  }
  return dist;
}

function computePositionsForUpstream({
  points,
  inboundAdj,
  focusUuid,
  maxDepth,
  ringStep,
  farRadius,
}) {
  const uuids = points?.uuids ?? [];
  const n = uuids.length;
  const positions = new Float32Array(n * 3);

  const dist = computeInboundDistancesFromFocus(
    inboundAdj,
    focusUuid,
    maxDepth,
  );

  for (let i = 0; i < n; i++) {
    const uuid = uuids[i];
    if (uuid === focusUuid) {
      positions[i * 3 + 0] = 0;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = 0;
      continue;
    }
    const d = dist.get(uuid);
    const unreachable = d == null;
    const layer = unreachable ? (maxDepth + 1) : d;
    const baseR = unreachable ? farRadius : (layer * ringStep);

    const h1 = hash32(`${focusUuid}::${uuid}::thetaUp`);
    const h2 = hash32(`${focusUuid}::${uuid}::phiUp`);
    const h3 = hash32(`${focusUuid}::${uuid}::rUp`);
    const u1 = u32ToU01(h1);
    const u2 = u32ToU01(h2);
    const uj = u32ToU01(h3);

    const theta = 2 * Math.PI * u1;
    const cosPhi = 1 - 2 * u2;
    const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
    const r = baseR * (0.78 + 0.44 * uj);

    // Push deeper hops a bit further away (z-) so the user can "fly" forward
    // through upstream shells.
    positions[i * 3 + 0] = Math.cos(theta) * sinPhi * r;
    positions[i * 3 + 1] = cosPhi * r;
    positions[i * 3 + 2] = Math.sin(theta) * sinPhi * r - (layer * 10);
  }

  return { positions, dist };
}

function buildUpstreamEdgesForFocus({
  focusUuid,
  inboundAdj,
  dist,
  maxDepth,
}) {
  /** @type {{ fromUuid: string, toUuid: string, share: number|null, weight: number, meanContribution: number|null }[]} */
  const edges = [];
  if (!focusUuid || !inboundAdj || !dist) return edges;

  // Cache allocations per toUuid so we can map share onto edges.
  /** @type {Map<string, Map<string, number>>} */
  const shareByTo = new Map();

  for (const [toUuid, d] of dist.entries()) {
    if (toUuid === focusUuid) {
      // ok, include inbound edges
    }
    if (d >= (maxDepth ?? 0)) continue;

    // Only consider nodes within the upstream subgraph.
    const ins = inboundAdj.get(toUuid) ?? new Set();
    if (ins.size === 0) continue;

    // Build share map for this node (impact allocation into toUuid).
    if (!shareByTo.has(toUuid)) {
      const alloc = computeInboundAllocationForFocus(toUuid);
      const m = new Map();
      for (const r of alloc.rows) m.set(r.fromUuid, r.share ?? 0);
      shareByTo.set(toUuid, m);
    }
    const shares = shareByTo.get(toUuid) ?? new Map();

    for (const fromUuid of ins) {
      const fromD = dist.get(fromUuid);
      if (fromD == null) continue;
      // Keep edges that progress one hop away from focus.
      if (fromD !== d + 1) continue;

      const info = edgeInfoBetween(edgeByDir, fromUuid, toUuid);
      const weight = info?.weight ?? 0;
      const meanContribution = info?.meanContribution ??
        readDerivedMeanContribution(SNAPSHOT, fromUuid, toUuid);
      const share = shares.get(fromUuid) ?? null;
      edges.push({ fromUuid, toUuid, share, weight, meanContribution });
    }
  }

  return edges;
}

function computeGraphDistancesFromFocus(adjacency, focusUuid, maxDepth) {
  /** @type {Map<string, number>} */
  const dist = new Map();
  /** @type {string[]} */
  const q = [];

  if (!focusUuid || !adjacency?.has?.(focusUuid)) return dist;
  dist.set(focusUuid, 0);
  q.push(focusUuid);

  while (q.length) {
    const u = q.shift();
    const d = dist.get(u) ?? 0;
    if (d >= (maxDepth ?? 0)) continue;
    const neigh = adjacency.get(u) ?? new Set();
    for (const v of neigh) {
      if (!dist.has(v)) {
        dist.set(v, d + 1);
        q.push(v);
      }
    }
  }

  return dist;
}

function readDerivedMeanContribution(snapshot, fromUuid, toUuid) {
  const key = `${fromUuid}→${toUuid}`;
  const syn = snapshot?.derived?.synapses?.[key] ?? null;
  const stats = syn?.stats ?? null;
  const mc = stats?.meanContribution ?? stats?.mean_contribution ?? null;
  return typeof mc === "number" && Number.isFinite(mc) ? mc : null;
}

function annotateEdgeStatsFromDerived(snapshot, edgeByDir) {
  // Best-effort: not all snapshots contain derived synapse contributions.
  for (const [k, v] of edgeByDir.entries()) {
    const parts = k.split("→");
    if (parts.length !== 2) continue;
    const mc = readDerivedMeanContribution(snapshot, parts[0], parts[1]);
    if (mc != null) v.meanContribution = mc;
  }
}

function edgeInfoBetween(edgeByDir, a, b) {
  // Prefer the a→b direction if present, else b→a.
  const ab = edgeByDir.get(`${a}→${b}`) ?? null;
  if (ab) return { fromUuid: a, toUuid: b, ...ab };
  const ba = edgeByDir.get(`${b}→${a}`) ?? null;
  if (ba) return { fromUuid: b, toUuid: a, ...ba };
  return null;
}

function edgeStrength01(edgeInfo) {
  // Prefer contribution magnitude when available; fall back to |weight|.
  const c = edgeInfo?.meanContribution;
  const w = edgeInfo?.weight;
  const v = (typeof c === "number" && Number.isFinite(c))
    ? Math.abs(c)
    : Math.abs(w ?? 0);
  if (!(v > 0)) return 0;
  // Compress dynamic range for readability.
  return Math.min(1, Math.sqrt(v) / 3);
}

function getInboundSynapsesForFocus(focusUuid) {
  if (!graph?.synapses || !focusUuid) return [];
  return graph.synapses.filter((s) => s.toUuid === focusUuid);
}

function getInboundFromUuidsForFocus(focusUuid) {
  const inbound = getInboundSynapsesForFocus(focusUuid);
  const out = [];
  for (const s of inbound) out.push(s.fromUuid);
  return out;
}

function computeInboundAllocationForFocus(focusUuid) {
  const inbound = getInboundSynapsesForFocus(focusUuid);
  const neuronImpact = impactsByUuid?.[focusUuid] ?? null;

  const rows = inbound.map((s) => ({
    fromUuid: s.fromUuid,
    toUuid: s.toUuid,
    weight: s.weight,
    meanContribution: readDerivedMeanContribution(
      SNAPSHOT,
      s.fromUuid,
      s.toUuid,
    ),
  }));

  const allocation = computeInboundSynapseImpactAllocation({
    toUuid: focusUuid,
    neuronImpact: typeof neuronImpact === "number" ? neuronImpact : null,
    inboundSynapses: rows,
  });

  // Normalise for HUD/line usage.
  const out = (allocation?.synapses ?? []).slice().sort((a, b) =>
    (b.allocatedImpact ?? 0) - (a.allocatedImpact ?? 0)
  );

  return {
    neuronImpact: allocation?.neuronImpact ?? null,
    totalScore: allocation?.totalScore ?? 0,
    rows: out.map((r) => ({
      fromUuid: r.fromUuid,
      toUuid: r.toUuid,
      weight: r.weight,
      meanContribution: r.meanContribution ?? null,
      score: r.score ?? null,
      share: r.share ?? 0,
      allocatedImpact: r.allocatedImpact ?? null,
    })),
  };
}

function computeReachableFromOutputs({ neuronsByUuid, synapses }) {
  // Directed reachability: which nodes can influence outputs?
  // If a node is reachable by traversing inbound edges from an output, then it
  // has a directed path to an output in the forward direction.
  /** @type {Map<string, Set<string>>} */
  const inbound = new Map();
  for (const uuid of neuronsByUuid.keys()) inbound.set(uuid, new Set());
  for (const s of synapses) {
    if (!inbound.has(s.toUuid)) inbound.set(s.toUuid, new Set());
    inbound.get(s.toUuid).add(s.fromUuid);
  }

  /** @type {string[]} */
  const outputs = [];
  for (const [uuid, n] of neuronsByUuid.entries()) {
    if (String(n?.type ?? "") === "output") outputs.push(uuid);
  }
  if (outputs.length === 0 && neuronsByUuid.has("output-0")) {
    outputs.push("output-0");
  }

  const seen = new Set();
  /** @type {string[]} */
  const q = [];
  for (const o of outputs) {
    seen.add(o);
    q.push(o);
  }
  while (q.length) {
    const u = q.shift();
    const ins = inbound.get(u) ?? new Set();
    for (const v of ins) {
      if (!seen.has(v)) {
        seen.add(v);
        q.push(v);
      }
    }
  }
  return seen;
}

function computePositionsForFocus({
  points,
  adjacency,
  focusUuid,
  maxDepth,
  ringStep,
  farRadius,
}) {
  const uuids = points?.uuids ?? [];
  const n = uuids.length;
  const positions = new Float32Array(n * 3);

  const dist = computeGraphDistancesFromFocus(adjacency, focusUuid, maxDepth);

  for (let i = 0; i < n; i++) {
    const uuid = uuids[i];
    if (uuid === focusUuid) {
      positions[i * 3 + 0] = 0;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = 0;
      continue;
    }

    const d = dist.get(uuid);
    const unreachable = d == null;

    const layer = unreachable ? (maxDepth + 1) : d;
    const baseR = unreachable ? farRadius : (layer * ringStep);

    // Stable per-(focus, uuid) orientation so the neighbourhood "feels" anchored
    // as you traverse.
    const h1 = hash32(`${focusUuid}::${uuid}::theta`);
    const h2 = hash32(`${focusUuid}::${uuid}::phi`);
    const h3 = hash32(`${focusUuid}::${uuid}::r`);

    const u1 = u32ToU01(h1);
    const u2 = u32ToU01(h2);
    const uj = u32ToU01(h3);

    const theta = 2 * Math.PI * u1;
    const cosPhi = 1 - 2 * u2;
    const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));

    // Mild radial jitter to reduce obvious rings/planes.
    const r = baseR * (0.78 + 0.44 * uj);

    positions[i * 3 + 0] = Math.cos(theta) * sinPhi * r;
    positions[i * 3 + 1] = cosPhi * r;
    positions[i * 3 + 2] = Math.sin(theta) * sinPhi * r;
  }

  return positions;
}

function buildStarPoints({ snapshot, neuronsByUuid, synapses }) {
  const impacts = getImpacts(snapshot);
  const recByUuid = snapshot?.recording?.neurons ?? {};

  /** @type {string[]} */
  const uuids = Array.from(neuronsByUuid.keys());

  // Stable ordering improves point picking determinism.
  uuids.sort((a, b) => String(a).localeCompare(String(b)));

  const n = uuids.length;
  const colours = new Float32Array(n * 4);
  const sizes = new Float32Array(n);

  /** @type {{ uuid: string, type: string, squash: string, impact: number|null, risk: any }[]} */
  const meta = new Array(n);

  /** @type {Map<string, number>} */
  const indexByUuid = new Map();

  for (let i = 0; i < n; i++) {
    const uuid = uuids[i];
    indexByUuid.set(uuid, i);
    const type = getNeuronType(neuronsByUuid, uuid);
    const squash = getNeuronSquash(neuronsByUuid, uuid);
    const impact = (typeof impacts?.[uuid] === "number") ? impacts[uuid] : null;
    const rec = recByUuid?.[uuid] ?? null;

    const [r, g, b] = neuronColourRgb01(type, squash);

    const nonFinite = nonFiniteCounts(rec);
    const sat = saturationStats(type, squash, rec);
    const tail = errorTailStats(rec);
    const risk = computeRisk({ impact, nonFinite, sat, tail });

    // Encode risk into alpha, and keep RGB as base. Fragment shader turns alpha
    // into glow intensity.
    colours[i * 4 + 0] = r;
    colours[i * 4 + 1] = g;
    colours[i * 4 + 2] = b;
    colours[i * 4 + 3] = risk.score;

    // Size uses log impact (fallback). Keep bounded so huge impacts don't blow
    // up the render on small screens.
    let base = 2.5;
    if (impact != null && impact > 0) {
      const log = Math.log10(impact);
      // Typical impacts are in (0,1]; log10 gives negative values.
      base = 2.5 + Math.max(0, 1 + log) * 10;
    } else if (uuid.startsWith("input-")) {
      base = 2.8;
    }
    sizes[i] = Math.min(18, Math.max(2, base));

    meta[i] = { uuid, type, squash, impact, risk };
  }

  return { uuids, colours, sizes, meta, indexByUuid };
}

// ============================================================================
// WebGL renderer
// ============================================================================

function compileShader(gl, type, source) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const msg = gl.getShaderInfoLog(sh) || "Shader compile failed";
    gl.deleteShader(sh);
    throw new Error(msg);
  }
  return sh;
}

function createProgram(gl, vsSource, fsSource) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const msg = gl.getProgramInfoLog(prog) || "Program link failed";
    gl.deleteProgram(prog);
    throw new Error(msg);
  }
  return prog;
}

function mat4Identity() {
  const m = new Float32Array(16);
  m[0] = 1;
  m[5] = 1;
  m[10] = 1;
  m[15] = 1;
  return m;
}

function mat4Mul(a, b) {
  const out = new Float32Array(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      out[r * 4 + c] = a[r * 4 + 0] * b[0 * 4 + c] +
        a[r * 4 + 1] * b[1 * 4 + c] +
        a[r * 4 + 2] * b[2 * 4 + c] +
        a[r * 4 + 3] * b[3 * 4 + c];
    }
  }
  return out;
}

function mat4Perspective(fovyRad, aspect, near, far) {
  const f = 1 / Math.tan(fovyRad / 2);
  const nf = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) * nf;
  m[11] = -1;
  m[14] = (2 * far * near) * nf;
  return m;
}

function mat4Translate(tx, ty, tz) {
  const m = mat4Identity();
  m[12] = tx;
  m[13] = ty;
  m[14] = tz;
  return m;
}

function mat4RotateY(rad) {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const m = mat4Identity();
  m[0] = c;
  m[2] = s;
  m[8] = -s;
  m[10] = c;
  return m;
}

function mat4RotateX(rad) {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const m = mat4Identity();
  m[5] = c;
  m[6] = -s;
  m[9] = s;
  m[10] = c;
  return m;
}

function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}

function fmtSig(n, sig = 4) {
  if (n == null || typeof n !== "number") return "N/A";
  if (!Number.isFinite(n)) return String(n);
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs < 0.001 || abs >= 10000) return n.toExponential(sig - 1);
  return Number(n.toPrecision(sig)).toString();
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

class StarfieldRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    this.canvas = canvas;
    /** @type {WebGLRenderingContext} */
    const gl = canvas.getContext("webgl", { antialias: true, alpha: true }) ||
      canvas.getContext("experimental-webgl", {
        antialias: true,
        alpha: true,
      });
    if (!gl) throw new Error("WebGL not supported in this browser");
    this.gl = gl;

    this.program = createProgram(
      gl,
      `
      attribute vec3 aPos;
      attribute vec4 aCol;
      attribute float aSize;
      attribute float aFocus;

      uniform mat4 uProj;
      uniform mat4 uView;
      uniform float uPixelRatio;

      varying vec4 vCol;
      varying float vDepth;
      varying float vFocus;

      void main() {
        vec4 viewPos = uView * vec4(aPos, 1.0);
        vDepth = -viewPos.z;
        gl_Position = uProj * viewPos;

        // Perspective-ish size: closer stars are bigger.
        float depthScale = clamp(140.0 / max(6.0, vDepth), 0.5, 6.0);
        gl_PointSize = (aSize + 8.0 * aFocus) * depthScale * uPixelRatio;
        vCol = aCol;
        vFocus = aFocus;
      }
    `,
      `
      precision mediump float;
      varying vec4 vCol;
      varying float vDepth;
      varying float vFocus;

      void main() {
        // Circular point sprite with a soft edge.
        vec2 uv = gl_PointCoord.xy * 2.0 - 1.0;
        float r2 = dot(uv, uv);
        if (r2 > 1.0) discard;

        float core = smoothstep(1.0, 0.0, r2);
        float glow = smoothstep(1.0, 0.2, r2);

        // Risk score comes in on alpha (0..1). Turn it into glow boost.
        float risk = clamp(vCol.a, 0.0, 1.0);

        // Background fade with depth (avoid a flat wall of points).
        float depthFade = clamp(1.2 - (vDepth / 180.0), 0.15, 1.0);

        vec3 base = vCol.rgb;
        // Focus gets a strong "you are here" cyan tint.
        vec3 focusTint = vec3(0.35, 0.95, 1.0);
        vec3 tint = mix(base, vec3(1.0, 0.45, 0.35), risk); // warm warning tint
        tint = mix(tint, focusTint, clamp(vFocus, 0.0, 1.0));

        float alpha = (0.25 * glow + 0.55 * core) * depthFade;
        alpha += risk * 0.35 * glow;
        alpha += vFocus * 0.55 * glow;
        gl_FragColor = vec4(tint, clamp(alpha, 0.0, 1.0));
      }
    `,
    );

    this.aPos = gl.getAttribLocation(this.program, "aPos");
    this.aCol = gl.getAttribLocation(this.program, "aCol");
    this.aSize = gl.getAttribLocation(this.program, "aSize");
    this.aFocus = gl.getAttribLocation(this.program, "aFocus");
    this.uProj = gl.getUniformLocation(this.program, "uProj");
    this.uView = gl.getUniformLocation(this.program, "uView");
    this.uPixelRatio = gl.getUniformLocation(this.program, "uPixelRatio");

    this.bufPos = gl.createBuffer();
    this.bufCol = gl.createBuffer();
    this.bufSize = gl.createBuffer();
    this.bufFocus = gl.createBuffer();

    // Lines (synapses) program
    this.lineProgram = createProgram(
      gl,
      `
      attribute vec3 aPos;
      attribute vec4 aCol;
      uniform mat4 uProj;
      uniform mat4 uView;
      varying vec4 vCol;
      void main() {
        gl_Position = uProj * (uView * vec4(aPos, 1.0));
        vCol = aCol;
      }
    `,
      `
      precision mediump float;
      varying vec4 vCol;
      void main() {
        gl_FragColor = vCol;
      }
    `,
    );
    this.lineAPos = gl.getAttribLocation(this.lineProgram, "aPos");
    this.lineACol = gl.getAttribLocation(this.lineProgram, "aCol");
    this.lineUProj = gl.getUniformLocation(this.lineProgram, "uProj");
    this.lineUView = gl.getUniformLocation(this.lineProgram, "uView");
    this.bufLinePos = gl.createBuffer();
    this.bufLineCol = gl.createBuffer();
    this.lineCount = 0;

    this.count = 0;
    this.meta = [];
    this.positions = null;
    this.indexByUuid = new Map();
    this.focusFlags = null;

    // Camera state
    this.yaw = 0;
    this.pitch = 0;
    this.pos = { x: 0, y: 0, z: 110 };
    this.fov = 55 * (Math.PI / 180);
    this.near = 0.1;
    this.far = 1000;
    this.pixelRatio = 1;

    // Input state
    this.drag = { active: false, lastX: 0, lastY: 0 };
    this.keys = new Set();
    this.focusIndex = -1;

    this._bindEvents();
  }

  resetCamera() {
    this.yaw = 0;
    this.pitch = 0;
    this.pos.x = 0;
    this.pos.y = 0;
    this.pos.z = 110;
  }

  _bindEvents() {
    const c = this.canvas;
    c.addEventListener("mousedown", (e) => {
      this.drag.active = true;
      this.drag.lastX = e.clientX;
      this.drag.lastY = e.clientY;
    });
    window.addEventListener("mouseup", () => (this.drag.active = false));
    window.addEventListener("mousemove", (e) => {
      if (!this.drag.active) return;
      const dx = e.clientX - this.drag.lastX;
      const dy = e.clientY - this.drag.lastY;
      this.drag.lastX = e.clientX;
      this.drag.lastY = e.clientY;
      this.yaw += dx * 0.005;
      this.pitch += dy * 0.005;
      this.pitch = clamp(this.pitch, -1.35, 1.35);
    });

    // Touch drag
    c.addEventListener("touchstart", (e) => {
      const t = e.touches[0];
      if (!t) return;
      this.drag.active = true;
      this.drag.lastX = t.clientX;
      this.drag.lastY = t.clientY;
    }, { passive: true });
    window.addEventListener("touchend", () => (this.drag.active = false), {
      passive: true,
    });
    window.addEventListener("touchmove", (e) => {
      if (!this.drag.active) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - this.drag.lastX;
      const dy = t.clientY - this.drag.lastY;
      this.drag.lastX = t.clientX;
      this.drag.lastY = t.clientY;
      this.yaw += dx * 0.005;
      this.pitch += dy * 0.005;
      this.pitch = clamp(this.pitch, -1.35, 1.35);
    }, { passive: true });

    window.addEventListener("keydown", (e) => {
      this.keys.add(e.key.toLowerCase());
    });
    window.addEventListener("keyup", (e) => {
      this.keys.delete(e.key.toLowerCase());
    });

    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.pos.z += e.deltaY * 0.05;
      this.pos.z = clamp(this.pos.z, 20, 520);
    }, { passive: false });

    c.addEventListener("click", (e) => {
      if (!this.positions || !this.meta?.length) return;
      const idx = this.pickStarIndex(e.clientX, e.clientY);
      if (idx >= 0) this.setFocus(idx);
    });
  }

  setData({ positions, colours, sizes, meta }) {
    const gl = this.gl;
    this.count = Math.floor(positions.length / 3);
    this.meta = meta ?? [];
    this.positions = positions;
    this.focusFlags = new Float32Array(this.count);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufPos);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufCol);
    gl.bufferData(gl.ARRAY_BUFFER, colours, gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufSize);
    gl.bufferData(gl.ARRAY_BUFFER, sizes, gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufFocus);
    gl.bufferData(gl.ARRAY_BUFFER, this.focusFlags, gl.DYNAMIC_DRAW);
  }

  updatePositions(positions) {
    const gl = this.gl;
    this.positions = positions;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufPos);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
  }

  updateFocusFlag(idx) {
    if (!this.focusFlags) return;
    this.focusFlags.fill(0);
    if (idx >= 0 && idx < this.focusFlags.length) this.focusFlags[idx] = 1;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufFocus);
    gl.bufferData(gl.ARRAY_BUFFER, this.focusFlags, gl.DYNAMIC_DRAW);
  }

  updateLines(linePositions, lineColours) {
    const gl = this.gl;
    this.lineCount = Math.floor(linePositions.length / 3);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufLinePos);
    gl.bufferData(gl.ARRAY_BUFFER, linePositions, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufLineCol);
    gl.bufferData(gl.ARRAY_BUFFER, lineColours, gl.DYNAMIC_DRAW);
  }

  resizeToDisplaySize() {
    const canvas = this.canvas;
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const w = Math.floor(canvas.clientWidth * dpr);
    const h = Math.floor(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    this.pixelRatio = dpr;
  }

  getViewMatrix() {
    // View = rotate then translate (camera transform inverse).
    const rx = mat4RotateX(this.pitch);
    const ry = mat4RotateY(this.yaw);
    const rot = mat4Mul(rx, ry);
    const tr = mat4Translate(-this.pos.x, -this.pos.y, -this.pos.z);
    return mat4Mul(rot, tr);
  }

  update(dtSeconds) {
    const speed = 55; // world units / sec
    const boost = this.keys.has("shift") ? 2.2 : 1.0;
    const v = speed * boost * dtSeconds;

    // Forward vector (yaw/pitch) in camera space.
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    const fx = sy * cp;
    const fy = -sp;
    const fz = cy * cp;

    // Right vector from yaw only (keeps strafe intuitive).
    const rx = cy;
    const rz = -sy;

    if (this.keys.has("w") || this.keys.has("arrowup")) {
      this.pos.x += fx * v;
      this.pos.y += fy * v;
      this.pos.z += fz * v;
    }
    if (this.keys.has("s") || this.keys.has("arrowdown")) {
      this.pos.x -= fx * v;
      this.pos.y -= fy * v;
      this.pos.z -= fz * v;
    }
    if (this.keys.has("a") || this.keys.has("arrowleft")) {
      this.pos.x -= rx * v;
      this.pos.z -= rz * v;
    }
    if (this.keys.has("d") || this.keys.has("arrowright")) {
      this.pos.x += rx * v;
      this.pos.z += rz * v;
    }
    if (this.keys.has("q")) this.pos.y -= v;
    if (this.keys.has("e")) this.pos.y += v;
  }

  render() {
    const gl = this.gl;
    this.resizeToDisplaySize();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.program);

    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const proj = mat4Perspective(this.fov, aspect, this.near, this.far);
    const view = this.getViewMatrix();

    // Draw synapse lines first (slightly additive for readability).
    if (this.lineCount > 0) {
      gl.useProgram(this.lineProgram);
      gl.uniformMatrix4fv(this.lineUProj, false, proj);
      gl.uniformMatrix4fv(this.lineUView, false, view);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufLinePos);
      gl.enableVertexAttribArray(this.lineAPos);
      gl.vertexAttribPointer(this.lineAPos, 3, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufLineCol);
      gl.enableVertexAttribArray(this.lineACol);
      gl.vertexAttribPointer(this.lineACol, 4, gl.FLOAT, false, 0, 0);

      gl.drawArrays(gl.LINES, 0, this.lineCount);
    }

    // Then draw stars.
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uProj, false, proj);
    gl.uniformMatrix4fv(this.uView, false, view);
    gl.uniform1f(this.uPixelRatio, this.pixelRatio);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufPos);
    gl.enableVertexAttribArray(this.aPos);
    gl.vertexAttribPointer(this.aPos, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufCol);
    gl.enableVertexAttribArray(this.aCol);
    gl.vertexAttribPointer(this.aCol, 4, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufSize);
    gl.enableVertexAttribArray(this.aSize);
    gl.vertexAttribPointer(this.aSize, 1, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufFocus);
    gl.enableVertexAttribArray(this.aFocus);
    gl.vertexAttribPointer(this.aFocus, 1, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.POINTS, 0, this.count);
  }

  projectPointToScreen(x, y, z) {
    // Minimal projection used for picking only (recompute matrices here to keep
    // the code simple; N is large but picking runs on click only).
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const proj = mat4Perspective(this.fov, aspect, this.near, this.far);
    const view = this.getViewMatrix();

    // Multiply: clip = proj * view * [x,y,z,1]
    const vx = view[0] * x + view[4] * y + view[8] * z + view[12];
    const vy = view[1] * x + view[5] * y + view[9] * z + view[13];
    const vz = view[2] * x + view[6] * y + view[10] * z + view[14];
    const vw = view[3] * x + view[7] * y + view[11] * z + view[15];

    const cx = proj[0] * vx + proj[4] * vy + proj[8] * vz + proj[12] * vw;
    const cy = proj[1] * vx + proj[5] * vy + proj[9] * vz + proj[13] * vw;
    const cz = proj[2] * vx + proj[6] * vy + proj[10] * vz + proj[14] * vw;
    const cw = proj[3] * vx + proj[7] * vy + proj[11] * vz + proj[15] * vw;

    if (cw === 0) return null;
    const ndcX = cx / cw;
    const ndcY = cy / cw;
    const ndcZ = cz / cw;
    if (ndcZ < -1 || ndcZ > 1) return null;

    const sx = (ndcX * 0.5 + 0.5) * this.canvas.width;
    const sy = (-ndcY * 0.5 + 0.5) * this.canvas.height;
    return { sx, sy, depth: ndcZ };
  }

  pickStarIndex(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const px = (clientX - rect.left) * this.pixelRatio;
    const py = (clientY - rect.top) * this.pixelRatio;

    // Pick nearest within a radius. O(N) but only on click.
    let best = -1;
    let bestD2 = Infinity;

    for (let i = 0; i < this.count; i++) {
      const x = this.positions[i * 3 + 0];
      const y = this.positions[i * 3 + 1];
      const z = this.positions[i * 3 + 2];
      const p = this.projectPointToScreen(x, y, z);
      if (!p) continue;
      const dx = p.sx - px;
      const dy = p.sy - py;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = i;
      }
    }

    // Threshold (in pixels^2).
    if (bestD2 > (18 * this.pixelRatio) ** 2) return -1;
    return best;
  }

  setFocus(idx) {
    this.focusIndex = idx;
    this.updateFocusFlag(idx);
    this.onFocusChanged?.(idx, this.meta[idx] ?? null);
  }
}

// ============================================================================
// App orchestration
// ============================================================================

let renderer = null;
let SNAPSHOT = null;
let graph = null;
let points = null;
let adjacency = null;
let edgeByDir = null;
let impactsByUuid = {};
let inboundAdjacency = null;

/** @type {"impact"|"paths"|"neighbourhood"} */
let viewMode = "impact";

function exposeDebugApi() {
  // Expose a small, stable debug API so Playwright can verify exploration flows
  // (focus output -> hop to neighbours -> inspect flags) before taking README
  // screenshots.
  //
  // This is intentionally minimal and non-invasive (safe to ship).
  try {
    window.__neatStarfield = {
      getSnapshotLoaded: () => Boolean(SNAPSHOT),
      getFocusUuid: () =>
        renderer?.meta?.[renderer?.focusIndex ?? -1]?.uuid ??
          null,
      getDefaultOutputUuid: () => {
        if (!renderer?.meta?.length) return null;
        for (const m of renderer.meta) {
          if (m?.uuid === "output-0") return "output-0";
        }
        for (const m of renderer.meta) {
          if (String(m?.type ?? "") === "output") return m.uuid ?? null;
        }
        return null;
      },
      getNeighbourUuids: (uuid) => {
        if (!adjacency || !uuid) return [];
        return Array.from(adjacency.get(String(uuid)) ?? []);
      },
      focusByUuid: (uuid) => {
        if (!points || !renderer || !uuid) return false;
        const idx = points.indexByUuid.get(String(uuid));
        if (idx == null) return false;
        renderer.setFocus(idx);
        return true;
      },
      pickHighestRiskNeighbour: (uuid) => {
        if (!points || !renderer || !adjacency || !uuid) return null;
        const u = String(uuid);
        const neigh = Array.from(adjacency.get(u) ?? []);
        let best = null;
        let bestScore = -Infinity;
        for (const v of neigh) {
          const idx = points.indexByUuid.get(v);
          if (idx == null) continue;
          const m = renderer.meta[idx];
          const s = m?.risk?.score;
          const score = typeof s === "number" && Number.isFinite(s) ? s : 0;
          if (score > bestScore) {
            bestScore = score;
            best = v;
          }
        }
        return best;
      },
    };
  } catch (_e) {
    // No-op.
  }
}

function pickDefaultFocusIndex(points, neuronsByUuid) {
  const uuids = points?.uuids ?? [];
  if (!uuids.length) return -1;

  // Prefer output-0 (or any output neuron) so the first impression is useful.
  for (let i = 0; i < uuids.length; i++) {
    const u = uuids[i];
    if (u === "output-0") return i;
  }
  for (let i = 0; i < uuids.length; i++) {
    const u = uuids[i];
    const t = String(neuronsByUuid.get(u)?.type ?? "");
    if (t === "output") return i;
  }

  // Fall back to the highest-impact node (if present).
  let bestIdx = -1;
  let bestImpact = -Infinity;
  for (let i = 0; i < points.meta.length; i++) {
    const imp = points.meta[i]?.impact;
    if (typeof imp === "number" && Number.isFinite(imp) && imp > bestImpact) {
      bestImpact = imp;
      bestIdx = i;
    }
  }
  if (bestIdx >= 0) return bestIdx;

  return Math.max(0, Math.floor(uuids.length / 2));
}

function setHudText(s) {
  if (!el.hud) return;
  el.hud.textContent = String(s ?? "");
}

function setFocusBadge(uuid) {
  if (!el.focusBadge) return;
  if (!uuid) {
    el.focusBadge.textContent = "";
    return;
  }
  const alias = getAlias(uuid);
  const desc = getDescription(uuid);
  const title = desc ? `${uuid} — ${desc}` : uuid;
  if (alias) {
    el.focusBadge.innerHTML = `<span class="alias" title="${
      escapeHtml(title)
    }">${escapeHtml(alias)}</span><span class="uuid">${
      escapeHtml(uuid)
    }</span>`;
  } else {
    el.focusBadge.textContent = uuid;
    el.focusBadge.title = title;
  }
}

function clearLabelOverlay() {
  const root = el.labelOverlay;
  if (!root) return;
  root.innerHTML = "";
}

function setLabelOverlayItems(items) {
  const root = el.labelOverlay;
  if (!root) return;
  root.innerHTML = "";
  for (const it of items) {
    const div = document.createElement("div");
    div.className = "starLabel" + (it.isFocus ? " isFocus" : "");
    div.style.left = `${it.x}px`;
    div.style.top = `${it.y}px`;
    if (typeof it.opacity === "number") div.style.opacity = String(it.opacity);
    if (typeof it.scale === "number") {
      div.style.transform = `translate(-50%, -120%) scale(${it.scale})`;
    }
    if (it.title) div.title = it.title;
    if (it.isFocus) {
      div.innerHTML = `<span class="alias">${escapeHtml(it.text)}</span>${
        it.uuidSuffix
          ? `<span class="uuid">${escapeHtml(it.uuidSuffix)}</span>`
          : ""
      }`;
    } else {
      div.textContent = it.text;
    }
    root.appendChild(div);
  }
}

let lastLabelUpdateMs = 0;

function updateLabelsForFocus(focusUuid, opts) {
  if (!renderer || !points || !adjacency || !focusUuid) {
    clearLabelOverlay();
    return;
  }
  if (!el.labelOverlay) return;

  // Throttle label updates for mobile performance (labels don't need 60fps).
  //
  // Important: when the focus changes (or we recompute a layout), we must
  // re-project labels *immediately* using the updated `renderer.positions`,
  // otherwise labels can briefly appear in the wrong spot. Callers can bypass
  // the throttle using `{ force: true }`.
  const force = Boolean(opts?.force);
  const now = performance.now();
  const minIntervalMs = 100;
  if (!force && now - lastLabelUpdateMs < minIntervalMs) return;
  lastLabelUpdateMs = now;

  // Label the focus and a small, high-signal subset of neighbours only.
  //
  // Important for iPhone/iPad: creating/updating 100-150 DOM nodes per frame can
  // tank performance. Keep the label set small and stable.
  const neighAll = Array.from(adjacency.get(focusUuid) ?? []);
  const maxNeighbourLabels = 24;
  const neigh = (viewMode === "impact" && edgeByDir)
    ? computeInboundAllocationForFocus(focusUuid).rows
      .slice(0, maxNeighbourLabels)
      .map((r) => r.fromUuid)
    : neighAll.slice(0, maxNeighbourLabels);
  const want = [focusUuid, ...neigh];

  /** @type {{ uuid: string, text: string, x: number, y: number, isFocus: boolean, title: string, uuidSuffix: string|null }[]} */
  const out = [];

  // Compute pixel ratio-adjusted positions based on current camera matrices.
  const rect = renderer.canvas.getBoundingClientRect();
  const dpr = renderer.pixelRatio ?? 1;

  for (const u of want) {
    const idx = points.indexByUuid.get(u);
    if (idx == null) continue;
    const xw = renderer.positions[idx * 3 + 0];
    const yw = renderer.positions[idx * 3 + 1];
    const zw = renderer.positions[idx * 3 + 2];
    const p = renderer.projectPointToScreen(xw, yw, zw);
    if (!p) continue;
    // Convert from GL canvas pixels to CSS pixels.
    // Place within overlay coordinates (overlay is positioned over the canvas).
    const x = p.sx / dpr;
    const y = p.sy / dpr;

    const isFocus = u === focusUuid;
    const text = labelText(u);
    const title = getDescription(u) ? `${u} — ${getDescription(u)}` : u;
    // Depth-aware label styling: far stars get smaller + fainter labels.
    // `p.depth` is NDC z in [-1, 1], where smaller tends to be closer.
    const depth01 = Math.min(1, Math.max(0, (p.depth + 1) / 2));
    const opacity = isFocus ? 1 : (0.15 + (1 - depth01) * 0.75);
    const scale = isFocus ? 1.05 : (0.72 + (1 - depth01) * 0.45);
    out.push({
      uuid: u,
      text,
      x,
      y,
      isFocus,
      title,
      uuidSuffix: getAlias(u) ? shortUuid(u) : null,
      opacity,
      scale,
    });
  }

  setLabelOverlayItems(out);
}

function buildHudForIndex(idx) {
  if (!renderer || !renderer.meta?.length || idx < 0) {
    setHudText(
      "No focus.\n\nTip: click a star to inspect it. The warmer/glowier stars are more suspicious.",
    );
    return;
  }

  const m = renderer.meta[idx];
  const bias = getNeuronBias(graph.neuronsByUuid, m.uuid);
  const stats = getNeuronStats(SNAPSHOT, m.uuid);
  const mse = stats?.meanSquaredError ?? stats?.mean_squared_error ?? null;
  const mae = stats?.meanAbsoluteError ?? stats?.mean_absolute_error ?? null;
  const directNeighbours = adjacency?.get?.(m.uuid)?.size ?? 0;
  const desc = getDescription(m.uuid);
  const ignoredInputs = (() => {
    if (!graph?.creature) return [];
    const inputCount = graph.creature.input ?? 0;
    if (!(inputCount > 0) || !graph?.neuronsByUuid) return [];
    const reachable = computeReachableFromOutputs({
      neuronsByUuid: graph.neuronsByUuid,
      synapses: graph.synapses,
    });
    const out = [];
    for (let i = 0; i < inputCount; i++) {
      const uuid = `input-${i}`;
      if (!reachable.has(uuid)) out.push(uuid);
    }
    return out;
  })();

  const lines = [];
  lines.push(`Focus: ${displayName(m.uuid)}`);
  if (getAlias(m.uuid)) lines.push(`UUID:  ${m.uuid}`);
  lines.push(`Type:  ${m.type}`);
  if (desc) lines.push(`Desc:  ${desc}`);
  if (!m.uuid.startsWith("input-")) {
    lines.push(`Squash: ${m.squash}`);
    if (bias != null) lines.push(`Bias:  ${fmtSig(bias, 6)}`);
  }
  if (m.impact != null) lines.push(`Impact: ${fmtSig(m.impact, 6)}`);
  if (mse != null) lines.push(`MSE:   ${fmtSig(mse, 6)}`);
  if (mae != null) lines.push(`MAE:   ${fmtSig(mae, 6)}`);
  lines.push(`Risk:  ${fmtSig(m.risk?.score ?? 0, 3)}`);
  lines.push(`Links: ${directNeighbours}`);
  if (ignoredInputs.length) {
    lines.push(`Ignored observations: ${ignoredInputs.length}`);
    const top = ignoredInputs.slice(0, 8).map((u) => labelText(u)).join(", ");
    if (top) {
      lines.push(`Top:   ${top}${ignoredInputs.length > 8 ? ", …" : ""}`);
    }
  }

  // Synapse summary (top links).
  if (edgeByDir) {
    const focusUuid = m.uuid;

    if (viewMode === "impact") {
      const alloc = computeInboundAllocationForFocus(focusUuid);
      const top = alloc.rows.slice(0, 10);
      if (top.length) {
        lines.push("");
        lines.push("Inbound impact (top):");
        for (const r of top) {
          const name = displayName(r.fromUuid);
          const wStr = fmtSig(r.weight, 4);
          const mcStr = r.meanContribution != null
            ? fmtSig(r.meanContribution, 4)
            : "N/A";
          const aStr = r.allocatedImpact != null
            ? fmtSig(r.allocatedImpact, 4)
            : "N/A";
          const pct = fmtSig((r.share ?? 0) * 100, 3) + "%";
          lines.push(
            `- ${name}  alloc=${aStr} (${pct})  w=${wStr}  c=${mcStr}`,
          );
        }
      } else {
        lines.push("");
        lines.push(
          "Inbound impact: N/A (no inbound synapses or missing impact)",
        );
      }
    } else {
      const neigh = Array.from(adjacency?.get(focusUuid) ?? []);
      const items = neigh.map((u) => {
        const info = edgeInfoBetween(edgeByDir, focusUuid, u);
        const strength = edgeStrength01(info);
        const w = info?.weight ?? 0;
        const mc = info?.meanContribution ?? null;
        return { uuid: u, info, strength, w, mc };
      }).sort((a, b) => (b.strength ?? 0) - (a.strength ?? 0));

      const top = items.slice(0, 8);
      if (top.length) {
        lines.push("");
        lines.push("Top links:");
        for (const it of top) {
          const name = displayName(it.uuid);
          const wStr = fmtSig(it.w, 4);
          const mcStr = it.mc != null ? fmtSig(it.mc, 4) : "N/A";
          const dir = it.info?.fromUuid && it.info?.toUuid
            ? `${it.info.fromUuid}→${it.info.toUuid}`
            : "";
          lines.push(
            `- ${name}  w=${wStr}  c=${mcStr}${dir ? "  " + dir : ""}`,
          );
        }
      }
    }
  }
  if (m.risk?.reasons?.length) {
    lines.push("");
    lines.push("Flags:");
    for (const r of m.risk.reasons) lines.push(`- ${r}`);
  }

  setHudText(lines.join("\n"));
}

async function loadSnapshotFromUrl(url) {
  setStatus(`Loading ${url}...`);
  showProgress(true);
  const obj = await fetchSnapshotJson(url, {
    onProgress: (p) => {
      if (!p.totalBytes) {
        showProgress(true);
        return;
      }
      showProgress(false);
      updateProgress((p.receivedBytes / p.totalBytes) * 100);
    },
  });
  hideProgress();
  return obj;
}

async function loadSnapshot(source, label) {
  try {
    setStatus(`Loading ${label}...`);
    const obj = typeof source === "string"
      ? await loadSnapshotFromUrl(source)
      : source;
    SNAPSHOT = obj;
    graph = normaliseCreature(obj);
    impactsByUuid = getImpacts(obj);
    loadLabelsFromSnapshot(obj);
    const adjPack = buildAdjacency(graph.neuronsByUuid, graph.synapses);
    adjacency = adjPack.adj;
    edgeByDir = adjPack.edgeByDir;
    annotateEdgeStatsFromDerived(obj, edgeByDir);
    inboundAdjacency = buildInboundAdjacency(
      graph.neuronsByUuid,
      graph.synapses,
    );

    // Build star points and feed the renderer.
    points = buildStarPoints({
      snapshot: obj,
      neuronsByUuid: graph.neuronsByUuid,
      synapses: graph.synapses,
    });

    const focusIdx = pickDefaultFocusIndex(points, graph.neuronsByUuid);
    const focusUuid = focusIdx >= 0 ? points.meta[focusIdx]?.uuid : null;
    const positions = computePositionsForFocus({
      points,
      adjacency,
      focusUuid,
      maxDepth: FOCUS_MAX_DEPTH,
      ringStep: FOCUS_RING_STEP,
      farRadius: FOCUS_FAR_RADIUS,
    });
    renderer.setData({
      positions,
      colours: points.colours,
      sizes: points.sizes,
      meta: points.meta,
    });
    renderer.resetCamera();
    renderer.setFocus(focusIdx);
    setFocusBadge(focusUuid);

    const neuronCount = (graph.creature.neurons ?? []).filter((n) =>
      n.type !== "input"
    ).length;
    const inputCount = graph.creature.input ?? 0;
    setStatus(
      `Observations: ${inputCount.toLocaleString()}, Neurons: ${neuronCount.toLocaleString()} & Synapses: ${graph.synapses.length.toLocaleString()}`,
      "ok",
    );
  } catch (e) {
    hideProgress();
    setStatus(e?.message ?? String(e), "bad");
    console.error(e);
  }
}

function initStarfield() {
  initThemeMode({ toggleButtonId: "themeToggle" });

  // Mode toggle (Impact Flow vs Neighbourhood).
  if (el.modeToggle) {
    const updateModeBtn = () => {
      el.modeToggle.textContent = viewMode === "impact"
        ? "Impact"
        : (viewMode === "paths" ? "Paths" : "Links");
      el.modeToggle.title = `Mode: ${
        viewMode === "impact"
          ? "Impact Flow"
          : (viewMode === "paths" ? "Upstream paths" : "Neighbourhood")
      } (tap to toggle)`;
    };
    updateModeBtn();
    el.modeToggle.addEventListener("click", () => {
      // Cycle: Impact -> Paths -> Links
      viewMode = viewMode === "impact"
        ? "paths"
        : (viewMode === "paths" ? "neighbourhood" : "impact");
      updateModeBtn();
      // Force a refresh of lines/HUD for current focus.
      const focusUuid = renderer?.meta?.[renderer.focusIndex]?.uuid ?? null;
      if (focusUuid) {
        renderer.onFocusChanged?.(
          renderer.focusIndex,
          renderer.meta[renderer.focusIndex],
        );
      }
    });
  }

  if (!(el.canvas instanceof HTMLCanvasElement)) {
    throw new Error("Missing #glCanvas");
  }
  renderer = new StarfieldRenderer(el.canvas);
  exposeDebugApi();
  renderer.onFocusChanged = (idx, m) => {
    // Re-centre the whole neighbourhood around the newly focused neuron.
    const focusUuid = m?.uuid ?? null;
    if (points && adjacency && focusUuid) {
      const positions = viewMode === "paths" && inboundAdjacency
        ? computePositionsForUpstream({
          points,
          inboundAdj: inboundAdjacency,
          focusUuid,
          maxDepth: UPSTREAM_MAX_DEPTH,
          ringStep: FOCUS_RING_STEP,
          farRadius: FOCUS_FAR_RADIUS,
        }).positions
        : computePositionsForFocus({
          points,
          adjacency,
          focusUuid,
          maxDepth: FOCUS_MAX_DEPTH,
          ringStep: FOCUS_RING_STEP,
          farRadius: FOCUS_FAR_RADIUS,
        });
      renderer.updatePositions(positions);
      // Update synapse lines to direct neighbours.
      if (edgeByDir) {
        if (viewMode === "paths" && inboundAdjacency) {
          const upstream = computePositionsForUpstream({
            points,
            inboundAdj: inboundAdjacency,
            focusUuid,
            maxDepth: UPSTREAM_MAX_DEPTH,
            ringStep: FOCUS_RING_STEP,
            farRadius: FOCUS_FAR_RADIUS,
          });
          const edges = buildUpstreamEdgesForFocus({
            focusUuid,
            inboundAdj: inboundAdjacency,
            dist: upstream.dist,
            maxDepth: UPSTREAM_MAX_DEPTH,
          });

          const linePos = new Float32Array(edges.length * 2 * 3);
          const lineCol = new Float32Array(edges.length * 2 * 4);
          let p = 0;
          let c = 0;

          for (const e of edges) {
            const iFrom = points.indexByUuid.get(e.fromUuid);
            const iTo = points.indexByUuid.get(e.toUuid);
            if (iFrom == null || iTo == null) continue;

            const fx = upstream.positions[iFrom * 3 + 0];
            const fy = upstream.positions[iFrom * 3 + 1];
            const fz = upstream.positions[iFrom * 3 + 2];
            const tx = upstream.positions[iTo * 3 + 0];
            const ty = upstream.positions[iTo * 3 + 1];
            const tz = upstream.positions[iTo * 3 + 2];

            linePos[p++] = fx;
            linePos[p++] = fy;
            linePos[p++] = fz;
            linePos[p++] = tx;
            linePos[p++] = ty;
            linePos[p++] = tz;

            const positive = (e.weight ?? 0) >= 0;
            const base = positive ? [0.25, 0.95, 0.55] : [1.0, 0.35, 0.35];
            const s01 = e.share != null
              ? clamp(Math.sqrt(Math.max(0, e.share)) * 2.2, 0, 1)
              : edgeStrength01(
                edgeInfoBetween(edgeByDir, e.fromUuid, e.toUuid),
              );
            const a = 0.05 + 0.85 * s01;
            for (let k = 0; k < 2; k++) {
              lineCol[c++] = base[0];
              lineCol[c++] = base[1];
              lineCol[c++] = base[2];
              lineCol[c++] = a;
            }
          }
          renderer.updateLines(linePos, lineCol);
        } else {
          const neigh = viewMode === "impact"
            ? getInboundFromUuidsForFocus(focusUuid)
            : Array.from(adjacency.get(focusUuid) ?? []);
          const linePos = new Float32Array(neigh.length * 2 * 3);
          const lineCol = new Float32Array(neigh.length * 2 * 4);
          let p = 0;
          let c = 0;

          // Precompute impact allocations (so line alpha reflects contribution).
          const alloc = viewMode === "impact"
            ? computeInboundAllocationForFocus(focusUuid)
            : null;
          const allocByFrom = alloc
            ? new Map(alloc.rows.map((r) => [r.fromUuid, r]))
            : new Map();

          for (const u of neigh) {
            const j = points.indexByUuid.get(u);
            if (j == null) continue;
            const x = positions[j * 3 + 0];
            const y = positions[j * 3 + 1];
            const z = positions[j * 3 + 2];
            // From focus origin to neighbour.
            linePos[p++] = 0;
            linePos[p++] = 0;
            linePos[p++] = 0;
            linePos[p++] = x;
            linePos[p++] = y;
            linePos[p++] = z;

            const info = edgeInfoBetween(edgeByDir, focusUuid, u);
            const allocRow = allocByFrom.get(u) ?? null;
            const s01 = viewMode === "impact"
              ? clamp(Math.sqrt(Math.max(0, allocRow?.share ?? 0)) * 2.2, 0, 1)
              : edgeStrength01(info);
            const w = info?.weight ?? 0;
            const positive = w >= 0;
            const base = positive ? [0.25, 0.95, 0.55] : [1.0, 0.35, 0.35];
            const a = 0.12 + 0.75 * s01;
            // Same colour for both endpoints.
            for (let k = 0; k < 2; k++) {
              lineCol[c++] = base[0];
              lineCol[c++] = base[1];
              lineCol[c++] = base[2];
              lineCol[c++] = a;
            }
          }
          renderer.updateLines(linePos, lineCol);
        }
      }
      renderer.resetCamera();
    }
    setFocusBadge(focusUuid);
    updateLabelsForFocus(focusUuid, { force: true });
    buildHudForIndex(idx);
  };
  buildHudForIndex(-1);

  // Wire loader controls.
  el.fetchBtn?.addEventListener("click", () => {
    const raw = String(el.fetchUrl?.value ?? "").trim() || DEFAULT_SNAPSHOT_URL;
    el.fetchUrl.value = raw;
    loadSnapshot(raw, raw);
  });

  el.fileBtn?.addEventListener("click", () => el.fileInput?.click?.());
  el.fileInput?.addEventListener("change", async () => {
    const file = el.fileInput?.files?.[0];
    if (!file) return;
    try {
      setStatus(`Reading ${file.name}...`);
      showProgress(true);
      const obj = await readSnapshotFile(file);
      hideProgress();
      await loadSnapshot(obj, file.name);
    } catch (e) {
      hideProgress();
      setStatus(e?.message ?? String(e), "bad");
    }
  });

  el.fetchUrl?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") el.fetchBtn?.click?.();
  });

  // Boot with default snapshot.
  el.fetchUrl.value = DEFAULT_SNAPSHOT_URL;
  loadSnapshot(DEFAULT_SNAPSHOT_URL, DEFAULT_SNAPSHOT_URL);

  // Animation loop
  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - lastT) / 1000));
    lastT = now;
    renderer.update(dt);
    renderer.render();
    // Keep labels in sync with camera motion.
    const focusUuid = renderer?.meta?.[renderer.focusIndex]?.uuid ?? null;
    if (focusUuid) updateLabelsForFocus(focusUuid);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

try {
  initStarfield();
} catch (e) {
  // iOS Safari can disable WebGL in low-power / privacy modes. Give a clearer
  // message than a blank screen.
  const msg = e?.message ?? String(e);
  setStatus(
    `Starfield failed to start: ${msg}. On iPhone/iPad: ensure WebGL is enabled (disable Low Power Mode, try Safari not in private browsing, and reload).`,
    "bad",
  );
  console.error(e);
}
