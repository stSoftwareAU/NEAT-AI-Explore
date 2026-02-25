/**
 * NEAT-AI Explore - Starfield view (Issue #25)
 *
 * A fun, intuitive 3D visualisation of a full creature graph. Each neuron is a
 * "star" whose colour/size encodes structural information, and whose glow
 * highlights "CT-scan style" problems (NaN/Infinity values, saturation, heavy
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
import {
  hash32,
  neuronColourRgb01,
  synapseWeightColourRgb01,
  u32ToU01,
} from "../shared/colour_maps.js";
import { computeInboundSynapseImpactAllocation } from "../impact_attribution.js";
import {
  AUTO_LOAD_MAX_RETRIES,
  AUTO_LOAD_RETRY_DELAY_MS,
  DEFAULT_SNAPSHOT_URL,
  SNAPSHOT_FALLBACK_URLS,
} from "../shared/config.js";
import {
  CAMERA_FLY_MS,
  FOCUS_PULSE_MS,
  prefersReducedMotion,
} from "../shared/transitions.js";
import {
  clampMomentum,
  classifyTouch,
  detectSwipeDirection,
  momentumStep,
  pinchZoomToward,
  RIPPLE_DURATION_MS,
  TAP_THRESHOLD_PX,
  TOUCH_SCALE_FACTOR,
} from "../shared/touch_gestures.js";

// Starfield layout settings (tune for intuition > mathematical correctness).
const FOCUS_MAX_DEPTH = 5;
const FOCUS_RING_STEP = 30; // world units per graph hop away from focus
const FOCUS_FAR_RADIUS = 240; // unreachable / very far nodes
const UPSTREAM_MAX_DEPTH = 4; // hops shown in Paths mode (focused neuron -> upstream)

// Focus trail (navigation history).
// Keep bounded so it never grows without limit during long sessions.
const MAX_FOCUS_TRAIL = 64;

// Travel animation duration (ms) — uses shared config (#104).
const TRAVEL_DURATION = CAMERA_FLY_MS;

// Line budget (reduce clutter for high-fan-in NEAT neurons).
const MAX_INBOUND_LINES = 80;
const MAX_INBOUND_LINES_OUTPUT = 220;
const MIN_INBOUND_LINES = 16;
const MIN_INBOUND_SHARE = 0.004; // 0.4% of inbound allocation (tuned for signal)

const el = {
  fetchUrl: document.getElementById("fetchUrl"),
  fetchBtn: document.getElementById("fetchBtn"),
  fileInput: document.getElementById("fileInput"),
  fileBtn: document.getElementById("fileBtn"),
  backBtn: document.getElementById("backBtn"),
  zoomBtn: document.getElementById("zoomBtn"),
  progressContainer: document.getElementById("progressContainer"),
  progressBar: document.getElementById("progressBar"),
  status: document.getElementById("status"),
  canvas: document.getElementById("glCanvas"),
  labelOverlay: document.getElementById("labelOverlay"),
  hud: document.getElementById("hud"),
  hudBody: document.getElementById("hudBody"),
  hudToggle: document.getElementById("hudToggle"),
  focusBadge: document.getElementById("focusBadge"),
  legend: document.getElementById("legend"),
  legendToggle: document.getElementById("legendToggle"),
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

function getOutputUuids(neuronsByUuid) {
  /** @type {string[]} */
  const out = [];
  for (const [uuid, n] of neuronsByUuid.entries()) {
    if (uuid === "output-0") out.push(uuid);
    else if (String(n?.type ?? "") === "output") out.push(uuid);
  }
  // Stable ordering: prefer output-0 first, then lexical.
  out.sort((a, b) =>
    (a === "output-0" ? -1 : b === "output-0" ? 1 : 0) ||
    String(a).localeCompare(String(b))
  );
  return out;
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
// Glyph system (v1, shader-friendly)
// ============================================================================

// Glyph kinds are small integer codes passed to the WebGL point-sprite shader.
// Keep this list short so the visual language stays learnable at a glance.
//
// Notes (Australian English):
// - Shapes encode squash *families*, not every individual squash. The long tail
//   can be disambiguated via the HUD rather than visual noise.
// - Bias is encoded spatially via a nucleus offset (not colour).
const GLYPH = {
  CIRCLE: 0, // identity-ish
  WEDGE: 1, // rectifier-ish
  DIAMOND: 2, // polynomial / power-ish
  CHEVRON: 3, // sign-lossy / absolute-ish
  SQUARE: 4, // step / brittle / discrete
  SPLIT: 5, // conditional / min/max / selection
  CAPSULE: 6, // smooth saturating monotonic
  RING_LOBE: 7, // periodic / oscillatory
};

function glyphKindForNeuron(type, squash) {
  const t = String(type ?? "").toLowerCase();
  if (t === "input") return GLYPH.CIRCLE;
  if (t === "constant") return GLYPH.CIRCLE;

  const s = String(squash ?? "IDENTITY");
  const u = s.toUpperCase();

  // Explicitly cover the current published snapshot's common squashes so v1 is
  // immediately useful (Issue #43, 31-Dec-2025).
  if (u === "BENT_IDENTITY" || u === "IDENTITY") return GLYPH.CIRCLE;
  if (u === "SQUARE" || u === "CUBE") return GLYPH.DIAMOND;
  if (u === "ABSOLUTE") return GLYPH.CHEVRON;
  if (u === "STEP" || u === "BIPOLAR") return GLYPH.SQUARE;
  if (u === "IF" || u === "MINIMUM" || u === "MAXIMUM") return GLYPH.SPLIT;

  // Rectifier family.
  if (
    u.includes("RELU") || u.includes("LEAKY") || u === "ELU" || u === "SELU" ||
    u === "SOFTPLUS"
  ) {
    return GLYPH.WEDGE;
  }

  // Periodic family.
  if (u === "SINE" || u === "COSINE" || u === "TAN") return GLYPH.RING_LOBE;

  // Smooth saturating / bounded family.
  if (
    u.includes("TANH") || u.includes("SIGMOID") || u === "LOGISTIC" ||
    u === "LOGSIGMOID" || u === "SOFTSIGN" || u === "ARCTAN" || u === "ISRU" ||
    u === "BIPOLAR_SIGMOID"
  ) {
    return GLYPH.CAPSULE;
  }

  // Smooth-gated (modern NN) family: treat as capsule by default to keep
  // silhouette count low.
  if (u === "GELU" || u === "SWISH" || u === "MISH") return GLYPH.CAPSULE;

  // Fallback: neutral.
  return GLYPH.CIRCLE;
}

function typeCode(type) {
  const t = String(type ?? "").toLowerCase();
  if (t === "input") return 1;
  if (t === "output") return 2;
  if (t === "constant") return 3;
  return 0; // hidden/default
}

function biasToSigned01(bias) {
  if (typeof bias !== "number" || !Number.isFinite(bias) || bias === 0) {
    return 0;
  }
  const mag = Math.min(1, Math.sqrt(Math.abs(bias)) / 3.0);
  return (bias >= 0 ? 1 : -1) * mag;
}

function warnFlag01(nonFinite, sat) {
  const nfTotal = (nonFinite?.activation ?? 0) + (nonFinite?.value ?? 0) +
    (nonFinite?.errors ?? 0);
  if (nfTotal > 0) return 1;
  const dead = sat?.fracDead ?? 0;
  const clampFrac = sat?.fracClamped ?? 0;
  if (dead > 0.7 || clampFrac > 0.7) return 0.5;
  return 0;
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

function computeOutputPathToFocus({ neuronsByUuid, inboundAdj, focusUuid }) {
  if (!focusUuid || !inboundAdj) return [];
  const outputs = getOutputUuids(neuronsByUuid);
  if (!outputs.length) return [];

  /** @type {string[]} */
  const q = [];
  /** @type {Map<string, string|null>} */
  const prev = new Map(); // prev[child] = parent in the BFS tree (downstream)

  for (const o of outputs) {
    q.push(o);
    prev.set(o, null);
  }

  while (q.length) {
    const u = q.shift();
    if (!u) continue;
    if (u === focusUuid) break;
    const ins = inboundAdj.get(u) ?? new Set();
    for (const v of ins) {
      if (!prev.has(v)) {
        prev.set(v, u);
        q.push(v);
      }
    }
  }

  if (!prev.has(focusUuid)) return [];
  /** @type {string[]} */
  const rev = [];
  let cur = focusUuid;
  while (cur) {
    rev.push(cur);
    cur = prev.get(cur) ?? null;
  }
  // rev is focus -> ... -> output; reverse to output -> ... -> focus.
  rev.reverse();
  return rev;
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
  backUuid,
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
    //
    // Also bias the layout to feel more "first person": the focus is the
    // closest star, and most other stars sit in front (z-) so you can look
    // outward along paths. The node you came from (if any) is nudged behind
    // (z+), so you can turn around and see the way home.
    const rawZ = Math.sin(theta) * sinPhi * r;
    const forwardZ = rawZ - (layer * 10);
    positions[i * 3 + 2] = (backUuid && uuid === backUuid)
      ? (Math.abs(rawZ) + 28)
      : (-Math.abs(forwardZ));
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

function inboundLineCapForFocus(focusUuid) {
  if (!focusUuid || !graph?.neuronsByUuid) return MAX_INBOUND_LINES;
  const uuid = String(focusUuid);
  if (uuid.startsWith("output-")) return MAX_INBOUND_LINES_OUTPUT;
  const t = String(graph.neuronsByUuid.get(uuid)?.type ?? "").toLowerCase();
  if (t === "output") return MAX_INBOUND_LINES_OUTPUT;
  return MAX_INBOUND_LINES;
}

function selectInboundEdgesForRender(rows, focusUuid) {
  const all = Array.isArray(rows) ? rows : [];
  const cap = inboundLineCapForFocus(focusUuid);
  const strong = all.filter((r) => (r?.share ?? 0) >= MIN_INBOUND_SHARE);
  const out = strong.slice(0, cap);
  if (out.length >= MIN_INBOUND_LINES) return out;
  // Guarantee a minimum number of inbound lines so the view never feels empty.
  return all.slice(0, Math.min(cap, MIN_INBOUND_LINES));
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
  backUuid,
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
    // FPS-like depth bias: keep most stars in front (z-) so the focus reads as
    // "you are here" and linked nodes feel further away, not closer.
    const rawZ = Math.sin(theta) * sinPhi * r;
    const depthBias = layer * 6;
    positions[i * 3 + 2] = (backUuid && uuid === backUuid)
      ? (Math.abs(rawZ) + 24)
      : (-Math.abs(rawZ) - depthBias);
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
  const glyphs = new Float32Array(n);
  const bias = new Float32Array(n);
  const types = new Float32Array(n);
  const warn = new Float32Array(n);
  const inDeg = new Float32Array(n);
  const outDeg = new Float32Array(n);
  const vis = new Float32Array(n);

  // Degree counts (encode local "dendrite/axon-ness" hints in glyphs).
  /** @type {Map<string, number>} */
  const inCounts = new Map();
  /** @type {Map<string, number>} */
  const outCounts = new Map();
  for (const s of synapses ?? []) {
    if (!s) continue;
    const from = s.fromUuid;
    const to = s.toUuid;
    if (typeof from === "string") {
      outCounts.set(from, (outCounts.get(from) ?? 0) + 1);
    }
    if (typeof to === "string") {
      inCounts.set(to, (inCounts.get(to) ?? 0) + 1);
    }
  }

  let maxIn = 1;
  let maxOut = 1;
  for (const u of uuids) {
    maxIn = Math.max(maxIn, inCounts.get(u) ?? 0);
    maxOut = Math.max(maxOut, outCounts.get(u) ?? 0);
  }
  const degTo01 = (count, max) => {
    const c = Math.max(0, Number(count ?? 0));
    const m = Math.max(1, Number(max ?? 1));
    // Log scale so huge fan-in/out doesn't flatten everything.
    return Math.min(1, Math.log10(c + 1) / Math.log10(m + 1));
  };

  /** @type {{ uuid: string, type: string, squash: string, impact: number|null, risk: any }[]} */
  const meta = new Array(n);

  /** @type {Map<string, number>} */
  const indexByUuid = new Map();

  for (let i = 0; i < n; i++) {
    const uuid = uuids[i];
    indexByUuid.set(uuid, i);
    const type = getNeuronType(neuronsByUuid, uuid);
    const squash = getNeuronSquash(neuronsByUuid, uuid);
    const biasVal = getNeuronBias(neuronsByUuid, uuid);
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

    glyphs[i] = glyphKindForNeuron(type, squash);
    bias[i] = biasToSigned01(biasVal);
    types[i] = typeCode(type);
    warn[i] = warnFlag01(nonFinite, sat);
    inDeg[i] = degTo01(inCounts.get(uuid) ?? 0, maxIn);
    outDeg[i] = degTo01(outCounts.get(uuid) ?? 0, maxOut);
    // Visibility mask is updated on focus changes. Default to faint so the view
    // reads as a network (not a starfield) with a highlighted neighbourhood.
    vis[i] = 0.10;

    meta[i] = { uuid, type, squash, impact, risk };
  }

  return {
    uuids,
    colours,
    sizes,
    glyphs,
    bias,
    types,
    warn,
    inDeg,
    outDeg,
    vis,
    meta,
    indexByUuid,
  };
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

// Linear interpolation between a and b by t (0..1).
function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Smooth ease-in-out for travel animation (Issue #50).
function easing(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
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
      attribute float aGlyph;
      attribute float aBias;
      attribute float aType;
      attribute float aWarn;
      attribute float aInDeg;
      attribute float aOutDeg;
      attribute float aVis;

      uniform mat4 uProj;
      uniform mat4 uView;
      uniform float uPixelRatio;

      varying vec4 vCol;
      varying float vDepth;
      varying float vFocus;
      varying float vGlyph;
      varying float vBias;
      varying float vType;
      varying float vWarn;
      varying float vInDeg;
      varying float vOutDeg;
      varying float vVis;

      void main() {
        vec4 viewPos = uView * vec4(aPos, 1.0);
        vDepth = -viewPos.z;
        gl_Position = uProj * viewPos;

        // Perspective-ish size: closer neurons are bigger.
        float depthScale = clamp(140.0 / max(6.0, vDepth), 0.5, 6.0);
        // Focus should be obvious, but never a giant "blue sun". Clamp in CSS px
        // (then scale by pixel ratio) so the focused neuron remains readable.
        float focusBoost = 2.0 * aFocus;
        float sizeCss = (aSize + focusBoost) * depthScale;
        sizeCss = clamp(sizeCss, 2.0, 58.0);
        gl_PointSize = sizeCss * uPixelRatio;
        vCol = aCol;
        vFocus = aFocus;
        vGlyph = aGlyph;
        vBias = aBias;
        vType = aType;
        vWarn = aWarn;
        vInDeg = aInDeg;
        vOutDeg = aOutDeg;
        vVis = aVis;
      }
    `,
      `
      precision mediump float;
      uniform float uGlyphStyle;
      varying vec4 vCol;
      varying float vDepth;
      varying float vFocus;
      varying float vGlyph;
      varying float vBias;
      varying float vType;
      varying float vWarn;
      varying float vInDeg;
      varying float vOutDeg;
      varying float vVis;

      float smoothInside(float d, float edge) {
        // d <= 0 inside. edge is in sprite UV units.
        return smoothstep(edge, -edge, d);
      }

      float sdCircle(vec2 p, float r) {
        return length(p) - r;
      }

      float sdBox(vec2 p, vec2 b) {
        vec2 q = abs(p) - b;
        return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
      }

      float sdDiamond(vec2 p, float r) {
        return (abs(p.x) + abs(p.y)) - r;
      }

      float sdCapsuleX(vec2 p, float halfLen, float r) {
        vec2 q = vec2(abs(p.x) - halfLen, p.y);
        return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
      }

      float sdSegment(vec2 p, vec2 a, vec2 b, float r) {
        vec2 pa = p - a;
        vec2 ba = b - a;
        float h = clamp(dot(pa, ba) / max(1e-6, dot(ba, ba)), 0.0, 1.0);
        return length(pa - ba * h) - r;
      }

      float neuronDist(vec2 p, float inDeg01, float outDeg01, float typeCode01) {
        // Cell-icon style (matches the supplied mock-up more closely):
        // - Clean cell body silhouette (no dendrite/axon silhouette in the sprite)
        // - Type drives the body silhouette
        // - Connectivity is expressed by synapse ribbons (lines), not rays

        vec2 c = vec2(0.0, 0.0);
        float isInput = step(0.5, typeCode01) * (1.0 - step(1.5, typeCode01));
        float isOutput = step(1.5, typeCode01) * (1.0 - step(2.5, typeCode01));
        float isConst = step(2.5, typeCode01);

        // Base radius, with subtle impact of degree to keep some "activity" feel.
        float r = 0.78;
        r += 0.06 * inDeg01;
        r += 0.02 * outDeg01;
        if (isOutput > 0.5) r += 0.10;
        if (isInput > 0.5) r -= 0.06;

        // Slightly ruffled membrane so it reads as a cell, not a flat dot.
        float theta = atan(p.y, p.x);
        float ruffle = 0.03 + 0.02 * inDeg01;
        float rr = r + ruffle * sin(theta * 6.0 + 1.1) + 0.012 * sin(theta * 13.0 + 0.4);

        float d = sdCircle(p - c, rr);

        // Type-specific silhouette tweaks.
        if (isConst > 0.5) {
          // Constant: boxy cell (rounded-square feel).
          d = min(d, sdBox(p - c, vec2(0.72, 0.62)));
        }
        if (isInput > 0.5) {
          // Input: slight teardrop (sensor-like).
          d = min(d, sdCircle(p - vec2(-0.18, 0.0), rr * 0.92));
        }

        return d;
      }

      float glyphDist(vec2 p, float glyph) {
        // Signed distance: d <= 0 inside. Used to render a membrane outline.
        if (glyph < 0.5) { // CIRCLE
          return sdCircle(p, 0.95);
        }
        if (glyph < 1.5) { // WEDGE (rectifier-ish)
          // Circle body, then intersect with a half-plane cut.
          float d0 = sdCircle(p, 0.98);
          float cutLine = (p.x + 0.55) + 0.65 * abs(p.y);
          // Keep only where cutLine <= 0 (inside). Intersection => max().
          return max(d0, cutLine);
        }
        if (glyph < 2.5) { // DIAMOND
          return sdDiamond(p, 1.25);
        }
        if (glyph < 3.5) { // CHEVRON (absolute-ish)
          // A V-like region (above the lines) with a top cap.
          float vLine = abs(p.x) * 1.05 - (p.y + 0.65);
          float topCap = (p.y - 0.95);
          return max(vLine, -topCap); // inside when vLine<=0 and p.y<=0.95
        }
        if (glyph < 4.5) { // SQUARE
          return sdBox(p, vec2(0.95, 0.95));
        }
        if (glyph < 5.5) { // SPLIT (conditional/min/max)
          float d0 = sdCircle(p, 0.98);
          float cutLine = (p.x + 0.25 + 0.35 * p.y);
          return max(d0, cutLine); // circle with a chord cut
        }
        if (glyph < 6.5) { // CAPSULE
          return sdCapsuleX(p, 0.55, 0.55);
        }
        // RING_LOBE: approximate with a wavy annulus distance.
        float r = length(p);
        float theta = atan(p.y, p.x);
        float outer = 0.86 + 0.10 * sin(2.0 * theta);
        float inner = outer - 0.38;
        float dOuter = r - outer;
        float dInner = inner - r;
        return max(dOuter, dInner);
      }

      float glyphFill(vec2 p, float glyph) {
        // Note: glyph is a small integer in float form.
        // Keep shapes cheap: a few SDFs and a couple of trigs for ring-lobe only.
        if (glyph < 0.5) { // CIRCLE
          return smoothInside(sdCircle(p, 0.95), 0.04);
        }
        if (glyph < 1.5) { // WEDGE (rectifier-ish)
          // Start from a circle-ish body, then cut a diagonal to form a wedge.
          float base = smoothInside(sdCircle(p, 0.98), 0.04);
          float cut = smoothInside((p.x + 0.55) + 0.65 * abs(p.y), 0.05);
          // Keep only the right-ish region.
          return base * (1.0 - cut);
        }
        if (glyph < 2.5) { // DIAMOND
          return smoothInside(sdDiamond(p, 1.25), 0.06);
        }
        if (glyph < 3.5) { // CHEVRON (absolute-ish)
          // A filled "V" / chevron: intersection-ish of two regions.
          float a = smoothInside(abs(p.x) * 1.05 - (p.y + 0.65), 0.05);
          float b = smoothInside((p.y - 0.95), 0.05);
          // a is 1 above the V-lines; subtract a top cap to keep it compact.
          return a * (1.0 - b);
        }
        if (glyph < 4.5) { // SQUARE
          return smoothInside(sdBox(p, vec2(0.95, 0.95)), 0.04);
        }
        if (glyph < 5.5) { // SPLIT (conditional/min/max)
          // Circle with a hard chord cut (a "decision slice").
          float base = smoothInside(sdCircle(p, 0.98), 0.04);
          float cutLine = (p.x + 0.25 + 0.35 * p.y);
          float cut = smoothInside(cutLine, 0.03);
          return base * (1.0 - cut);
        }
        if (glyph < 6.5) { // CAPSULE (smooth saturating)
          return smoothInside(sdCapsuleX(p, 0.55, 0.55), 0.05);
        }
        // RING_LOBE (periodic): wavy annulus.
        float r = length(p);
        float theta = atan(p.y, p.x);
        float outer = 0.86 + 0.10 * sin(2.0 * theta);
        float inner = outer - 0.38;
        float dOuter = r - outer;
        float dInner = inner - r;
        float d = max(dOuter, dInner);
        return smoothInside(d, 0.05);
      }

      void main() {
        vec2 uv = gl_PointCoord.xy * 2.0 - 1.0;
        float isNeuron = step(0.5, uGlyphStyle);
        float dGlyph = glyphDist(uv, vGlyph);
        float dNeuron = neuronDist(uv, vInDeg, vOutDeg, vType);
        float d = mix(dGlyph, dNeuron, isNeuron);

        float fillGlyph = glyphFill(uv, vGlyph);
        float fillNeuron = smoothInside(dNeuron, 0.05);
        float fill = mix(fillGlyph, fillNeuron, isNeuron);
        if (fill <= 0.001) discard;

        float r2 = dot(uv, uv);
        float glow = smoothstep(1.25, 0.25, r2);
        // In neuron mode, reduce the halo so the node reads as a "body" rather
        // than a star.
        glow *= mix(1.0, 0.32, isNeuron);

        // Risk score comes in on alpha (0..1). Turn it into glow boost.
        float risk = clamp(vCol.a, 0.0, 1.0);

        // Background fade with depth (avoid a flat wall of points).
        float depthFade = clamp(1.2 - (vDepth / 180.0), 0.15, 1.0);

        vec3 base = vCol.rgb;
        // Focus gets a "you are here" tint, but in neuron mode keep it subtle so
        // the cell doesn't become a giant blue blob.
        vec3 focusTint = vec3(0.35, 0.95, 1.0);
        vec3 tint = mix(base, vec3(1.0, 0.45, 0.35), risk); // warm warning tint
        float focusMix = mix(1.0, 0.22, isNeuron);
        tint = mix(tint, focusTint, clamp(vFocus, 0.0, 1.0) * focusMix);

        // Nucleus indicates squash/activation family (Issue #44, 1-Jan-2026).
        // Render a nucleus circle + a squash-family mark inside it.
        vec2 nucleusC = vec2(-0.15, 0.05);
        float nucleusBase = smoothInside(sdCircle(uv - nucleusC, 0.30), 0.05);
        vec2 nucleusUv = (uv - nucleusC) / 0.30;
        float nucleusMask = smoothInside(sdCircle(nucleusUv, 0.92), 0.06);
        float nucleusMark = glyphFill(nucleusUv, vGlyph) * nucleusMask;
        float nucleus = max(nucleusBase * 0.85, nucleusMark);

        // Mitochondria: small capsule-ish dots inside the cell for "cellness".
        // Keep it deterministic and cheap (3 fixed positions).
        float mito = 0.0;
        mito = max(mito, smoothInside(sdCapsuleX(uv - vec2(0.30, 0.18), 0.10, 0.06), 0.04));
        mito = max(mito, smoothInside(sdCapsuleX(uv - vec2(0.24, -0.22), 0.11, 0.06), 0.04));
        mito = max(mito, smoothInside(sdCapsuleX(uv - vec2(-0.05, -0.28), 0.09, 0.06), 0.04));

        // Type markers: small dots at consistent corners (no text).
        // 1=input, 2=output, 3=constant.
        float typeDot = 0.0;
        if (vType > 0.5 && vType < 1.5) { // input
          typeDot = smoothInside(sdCircle(uv - vec2(-0.65, 0.65), 0.16), 0.04);
        } else if (vType > 1.5 && vType < 2.5) { // output
          typeDot = smoothInside(sdCircle(uv - vec2(0.65, -0.65), 0.16), 0.04);
        } else if (vType > 2.5) { // constant
          typeDot = smoothInside(sdCircle(uv, 0.14), 0.04);
        }

        // Membrane outline: keep it subtle but present so glyphs read as bodies.
        float edge = 0.045;
        float outline = smoothstep(edge * 2.0, edge, abs(d));

        // Error halo: show warnings/risk as a halo around the cell rather than
        // stripes across the soma (matches the neuron mock-up intent).
        float warn01 = clamp(max(vWarn, risk), 0.0, 1.0);
        // d is signed distance to the body: 0 at membrane, >0 outside.
        float outside = step(0.0, d);
        float haloRing = smoothstep(0.06, 0.00, abs(d - 0.14)) * outside;
        vec3 haloCol = vec3(1.0, 0.55, 0.20);

        vec3 nucleusTint = vec3(0.08, 0.10, 0.12);
        vec3 mitoTint = vec3(0.98, 0.78, 0.20);
        vec3 finalCol = mix(tint, nucleusTint, clamp(nucleus, 0.0, 1.0));
        finalCol = mix(finalCol, mitoTint, 0.55 * mito);
        finalCol = mix(finalCol, vec3(1.0), 0.12 * typeDot);
        finalCol = mix(finalCol, haloCol, 0.55 * warn01 * haloRing);
        finalCol = mix(finalCol, vec3(0.0), 0.35 * outline); // darker membrane edge

        // In neuron mode, overlay the squash-family glyph inside the soma as an
        // embossed mark so you still get the "function family" signal.
        if (isNeuron > 0.5) {
          vec2 somaUv = (uv - vec2(-0.22, 0.0)) / 0.72;
          float inner = glyphFill(somaUv, vGlyph) * smoothInside(sdCircle(somaUv, 0.98), 0.04);
          finalCol = mix(finalCol, vec3(1.0), 0.16 * inner);

          // Simple faux-3D shading for a more "3D-ish" feel on the sprite.
          float rr = min(1.0, r2);
          float nz = sqrt(max(0.0, 1.0 - rr));
          vec3 nrm = normalize(vec3(uv.xy, nz + 0.001));
          vec3 light = normalize(vec3(-0.55, 0.75, 1.0));
          float diff = clamp(dot(nrm, light), 0.0, 1.0);
          finalCol *= (0.70 + 0.55 * diff);
        }

        float alpha = fill * (0.75 + 0.20 * glow) * depthFade;
        alpha += risk * 0.25 * glow;
        alpha += 0.65 * warn01 * haloRing;

        // Focus highlight: in neuron mode prefer a membrane outline rather than
        // more glow, so the shape stays readable.
        float focusAlpha = vFocus * mix(0.45 * glow, 0.55 * outline, isNeuron);
        alpha += focusAlpha;
        alpha = max(alpha, 0.65 * (nucleus + typeDot));
        // Visibility mask: fade non-neighbourhood neurons so the view reads as a
        // network, not a starfield (Issue #44, 1-Jan-2026).
        alpha *= mix(0.06, 1.0, clamp(vVis, 0.0, 1.0));
        gl_FragColor = vec4(finalCol, clamp(alpha, 0.0, 1.0));
      }
    `,
    );

    this.aPos = gl.getAttribLocation(this.program, "aPos");
    this.aCol = gl.getAttribLocation(this.program, "aCol");
    this.aSize = gl.getAttribLocation(this.program, "aSize");
    this.aFocus = gl.getAttribLocation(this.program, "aFocus");
    this.aGlyph = gl.getAttribLocation(this.program, "aGlyph");
    this.aBias = gl.getAttribLocation(this.program, "aBias");
    this.aType = gl.getAttribLocation(this.program, "aType");
    this.aWarn = gl.getAttribLocation(this.program, "aWarn");
    this.aInDeg = gl.getAttribLocation(this.program, "aInDeg");
    this.aOutDeg = gl.getAttribLocation(this.program, "aOutDeg");
    this.aVis = gl.getAttribLocation(this.program, "aVis");
    this.uProj = gl.getUniformLocation(this.program, "uProj");
    this.uView = gl.getUniformLocation(this.program, "uView");
    this.uPixelRatio = gl.getUniformLocation(this.program, "uPixelRatio");
    this.uGlyphStyle = gl.getUniformLocation(this.program, "uGlyphStyle");

    this.bufPos = gl.createBuffer();
    this.bufCol = gl.createBuffer();
    this.bufSize = gl.createBuffer();
    this.bufFocus = gl.createBuffer();
    this.bufGlyph = gl.createBuffer();
    this.bufBias = gl.createBuffer();
    this.bufType = gl.createBuffer();
    this.bufWarn = gl.createBuffer();
    this.bufInDeg = gl.createBuffer();
    this.bufOutDeg = gl.createBuffer();
    this.bufVis = gl.createBuffer();

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

    // Synapse ribbon program (v2):
    // Render synapses as proper thick ribbons (triangles) so width is reliable
    // in WebGL1 (gl.LINES lineWidth is not portable).
    //
    // We expand each line segment in clip space in the vertex shader using the
    // segment direction projected into view space. This keeps thickness stable
    // in screen pixels (Issue #44, 1-Jan-2026).
    this.synProgram = createProgram(
      gl,
      `
      attribute vec3 aPos;
      attribute vec3 aDir;
      attribute float aSide;
      attribute float aWidthPx;
      attribute vec4 aCol;
      uniform mat4 uProj;
      uniform mat4 uView;
      uniform vec2 uViewport;
      varying vec4 vCol;
      void main() {
        vec4 viewPos = uView * vec4(aPos, 1.0);
        vec3 viewDir3 = (uView * vec4(aPos + aDir, 1.0)).xyz - viewPos.xyz;
        // NaN guard:
        // When a synapse segment is nearly parallel to the camera view direction,
        // viewDir3.xy can be ~zero length. normalize(vec2(0)) yields NaNs in
        // GLSL, which then corrupts clip-space expansion and can cause flicker
        // or missing ribbon segments (Issue #44, 1-Jan-2026).
        vec2 viewDir2 = viewDir3.xy;
        float viewLen2 = dot(viewDir2, viewDir2);
        vec2 d = viewDir2 * inversesqrt(max(viewLen2, 1e-8));
        // Perpendicular in screen plane (view space XY).
        vec2 p = vec2(-d.y, d.x);

        vec4 clip = uProj * viewPos;
        // Convert px -> NDC offset, then to clip via *w.
        vec2 pxToNdc = vec2(2.0 / max(1.0, uViewport.x), 2.0 / max(1.0, uViewport.y));
        vec2 ndcOffset = p * (aSide * aWidthPx) * pxToNdc;
        clip.xy += ndcOffset * clip.w;
        gl_Position = clip;
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
    this.synAPos = gl.getAttribLocation(this.synProgram, "aPos");
    this.synADir = gl.getAttribLocation(this.synProgram, "aDir");
    this.synASide = gl.getAttribLocation(this.synProgram, "aSide");
    this.synAWidth = gl.getAttribLocation(this.synProgram, "aWidthPx");
    this.synACol = gl.getAttribLocation(this.synProgram, "aCol");
    this.synUProj = gl.getUniformLocation(this.synProgram, "uProj");
    this.synUView = gl.getUniformLocation(this.synProgram, "uView");
    this.synUViewport = gl.getUniformLocation(this.synProgram, "uViewport");
    this.bufSynPos = gl.createBuffer();
    this.bufSynCol = gl.createBuffer();
    this.bufSynDir = gl.createBuffer();
    this.bufSynSide = gl.createBuffer();
    this.bufSynWidth = gl.createBuffer();
    this.synVertCount = 0;

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
    // Multi-touch state:
    // - Pinch: distance change zooms along view direction (Issue #39, 31-Dec-2025)
    // - Pan: midpoint drag translates the camera (Issue #41, 31-Dec-2025)
    this.pinch = { active: false, lastDist: 0, lastMidX: 0, lastMidY: 0 };
    // Touch gesture origin tracking: prevents off-canvas gestures (e.g. header
    // inputs/buttons) from accidentally enabling camera look/zoom via the
    // window-level touchend/touchmove handlers (Issue #41, 31-Dec-2025).
    this.touch = {
      startedOnCanvas: false,
      startX: 0,
      startY: 0,
      startTime: 0,
      longPressTimer: null,
      longPressFired: false,
    };
    // Momentum state for two-finger pan inertia (#106).
    this.momentum = { vx: 0, vy: 0, active: false, rafId: null };
    this.keys = new Set();
    this.focusIndex = -1;
    // Glyph style: 0=abstract (v1), 1=neuron silhouette.
    this.glyphStyle01 = 1;

    // Animation state for traveling effect (Issue #50).
    this.travelAnimation = null;

    // Callback to check if a neuron is connected to the current focus.
    // Set by the app to restrict clicks to connected neurons (Issue #50).
    /** @type {((clickedIdx: number) => boolean) | null} */
    this.isConnectedToFocus = null;

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

    // Touch controls (#106 — improved mobile touch interactions):
    // - 1 finger tap: focus neuron with ripple feedback
    // - 1 finger long press: show tooltip
    // - 1 finger drag: look (yaw/pitch)
    // - 2 fingers: pinch zoom toward midpoint + pan with momentum
    // - Horizontal swipe: cycle neurons in trace path
    const touchDistance = (t0, t1) =>
      Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);

    // Clear any long-press timer.
    const clearLongPress = () => {
      if (this.touch.longPressTimer !== null) {
        clearTimeout(this.touch.longPressTimer);
        this.touch.longPressTimer = null;
      }
    };

    // Stop momentum animation.
    const stopMomentum = () => {
      this.momentum.active = false;
      if (this.momentum.rafId !== null) {
        cancelAnimationFrame(this.momentum.rafId);
        this.momentum.rafId = null;
      }
    };

    // Run momentum deceleration loop for two-finger pan inertia (#106).
    const startMomentum = (rawVx, rawVy) => {
      stopMomentum();
      const clamped = clampMomentum(rawVx, rawVy);
      this.momentum.vx = clamped.vx;
      this.momentum.vy = clamped.vy;
      if (Math.hypot(clamped.vx, clamped.vy) < 0.15) return;
      this.momentum.active = true;

      const rx = Math.cos(this.yaw);
      const rz = -Math.sin(this.yaw);

      const tick = () => {
        if (!this.momentum.active) return;
        const step = momentumStep(this.momentum.vx, this.momentum.vy);
        this.momentum.vx = step.vx;
        this.momentum.vy = step.vy;
        this.momentum.active = step.active;

        if (step.active) {
          const dist = Math.hypot(this.pos.x, this.pos.y, this.pos.z);
          const panScale = Math.max(0.05, dist * 0.002);
          this.pos.x -= rx * step.vx * panScale;
          this.pos.z -= rz * step.vx * panScale;
          this.pos.y += step.vy * panScale;
          this.momentum.rafId = requestAnimationFrame(tick);
        } else {
          this.momentum.rafId = null;
        }
      };
      this.momentum.rafId = requestAnimationFrame(tick);
    };

    // Show ripple feedback at a screen position (#106).
    const showRipple = (clientX, clientY) => {
      const rect = c.getBoundingClientRect();
      const ripple = document.createElement("div");
      ripple.className = "touchRipple";
      ripple.style.left = (clientX - rect.left) + "px";
      ripple.style.top = (clientY - rect.top) + "px";
      const overlay = c.parentElement;
      if (overlay) overlay.appendChild(ripple);
      setTimeout(() => ripple.remove(), RIPPLE_DURATION_MS);
    };

    // Scale a node label on touch-start for visual feedback (#106).
    const scaleLabelAtIndex = (idx, scale) => {
      const overlay = document.getElementById("labelOverlay");
      if (!overlay) return;
      const labels = overlay.children;
      if (idx < 0 || idx >= labels.length) return;
      const label = /** @type {HTMLElement} */ (labels[idx]);
      if (scale !== 1) {
        label.style.transition = "transform 0.12s ease-out";
        label.style.transform = `translate(-50%, -120%) scale(${scale})`;
      } else {
        label.style.transition = "transform 0.15s ease-in";
        label.style.transform = "translate(-50%, -120%)";
      }
    };

    // Track whether the *gesture origin* (the 0→1 touch transition) began on
    // the canvas. This must not flip to true if a later touch begins on-canvas
    // while the first touch began off-canvas (Issue #42, 31-Dec-2025).
    //
    // Use capture so this runs before the canvas touchstart handler when the
    // gesture begins on the canvas.
    window.addEventListener(
      "touchstart",
      (e) => {
        const ts = e.touches;
        if (!ts || ts.length === 0) return;

        // Only evaluate origin at the start of a gesture (0→1 touch).
        if (ts.length !== 1) return;

        const path = typeof e.composedPath === "function"
          ? e.composedPath()
          : [];
        this.touch.startedOnCanvas = e.target === c || path.includes(c);

        if (!this.touch.startedOnCanvas) {
          // Defensive: ensure off-canvas gesture origin cannot accidentally
          // enable camera controls via other window-level touch handlers.
          this.drag.active = false;
          this.pinch.active = false;
        }
      },
      { passive: true, capture: true },
    );

    c.addEventListener("touchstart", (e) => {
      const ts = e.touches;
      if (!ts || ts.length === 0) return;

      // If the gesture started off-canvas (e.g. header UI), ignore later
      // touches that happen to begin on the canvas.
      if (!this.touch.startedOnCanvas) return;

      // Stop any ongoing momentum when a new touch begins.
      stopMomentum();

      // Pinch zoom initialisation.
      if (ts.length >= 2) {
        clearLongPress();
        this.pinch.active = true;
        this.drag.active = false;
        this.pinch.lastDist = touchDistance(ts[0], ts[1]);
        this.pinch.lastMidX = (ts[0].clientX + ts[1].clientX) / 2;
        this.pinch.lastMidY = (ts[0].clientY + ts[1].clientY) / 2;
        return;
      }

      const t = ts[0];
      this.touch.startX = t.clientX;
      this.touch.startY = t.clientY;
      this.touch.startTime = performance.now();
      this.touch.longPressFired = false;
      this.drag.active = true;
      this.pinch.active = false;
      this.drag.lastX = t.clientX;
      this.drag.lastY = t.clientY;

      // Touch feedback: scale up nearest neuron on touch-start (#106).
      if (this.positions && this.meta?.length) {
        const idx = this.pickStarIndex(t.clientX, t.clientY);
        if (idx >= 0) scaleLabelAtIndex(idx, TOUCH_SCALE_FACTOR);
      }

      // Start long-press timer (#106).
      clearLongPress();
      this.touch.longPressTimer = setTimeout(() => {
        this.touch.longPressFired = true;
        // Long-press triggers tooltip via the existing onFocusChanged callback.
        if (!this.positions || !this.meta?.length) return;
        const idx = this.pickStarIndex(t.clientX, t.clientY);
        if (idx >= 0) {
          this.onLongPress?.(idx, this.meta[idx] ?? null, t.clientX, t.clientY);
        }
      }, 500);
    }, { passive: false });

    window.addEventListener("touchend", (e) => {
      clearLongPress();
      const ts = e.touches;
      const ct = e.changedTouches;

      if (!ts || ts.length === 0) {
        // All fingers lifted — classify the single-finger gesture.
        if (this.touch.startedOnCanvas && ct && ct.length > 0) {
          const t = ct[0];
          const dx = t.clientX - this.touch.startX;
          const dy = t.clientY - this.touch.startY;
          const elapsed = performance.now() - this.touch.startTime;

          // Reset label scale for any previously scaled neuron.
          if (this.positions && this.meta?.length) {
            const startIdx = this.pickStarIndex(
              this.touch.startX,
              this.touch.startY,
            );
            if (startIdx >= 0) scaleLabelAtIndex(startIdx, 1);
          }

          if (!this.touch.longPressFired) {
            const gesture = classifyTouch(dx, dy, elapsed);
            if (gesture === "tap") {
              // Tap-to-focus with ripple (#106).
              if (this.positions && this.meta?.length) {
                const idx = this.pickStarIndex(t.clientX, t.clientY);
                if (idx >= 0) {
                  // Only allow tapping neurons connected to focus (Issue #50).
                  let allowed = true;
                  if (this.focusIndex >= 0 && this.isConnectedToFocus) {
                    allowed = this.isConnectedToFocus(idx);
                  }
                  if (allowed) {
                    showRipple(t.clientX, t.clientY);
                    this.setFocus(idx);
                  }
                }
              }
            } else if (gesture === "drag") {
              // Check for horizontal swipe to cycle neurons (#106).
              const swipe = detectSwipeDirection(dx, dy, elapsed);
              if (swipe) this.onSwipe?.(swipe);
            }
          }

          // Start momentum for two-finger pan if we were pinching.
          if (this.pinch.active && this.pinch.lastVx !== undefined) {
            startMomentum(this.pinch.lastVx, this.pinch.lastVy);
          }
        }

        this.drag.active = false;
        this.pinch.active = false;
        this.touch.startedOnCanvas = false;
        return;
      }

      // Important: touchend fires at window scope, including for gestures that
      // began on non-canvas UI. Never enable drag/pinch unless the current touch
      // gesture started on the canvas (Issue #41, 31-Dec-2025).
      if (!this.touch.startedOnCanvas) {
        this.drag.active = false;
        this.pinch.active = false;
        return;
      }

      // If we lifted one finger but still have one touch, transition back to
      // look mode smoothly.
      if (ts.length === 1) {
        const t = ts[0];
        this.drag.active = true;
        this.pinch.active = false;
        this.drag.lastX = t.clientX;
        this.drag.lastY = t.clientY;
        return;
      }

      // Still pinching (2+ fingers).
      this.pinch.active = true;
      this.drag.active = false;
      this.pinch.lastDist = touchDistance(ts[0], ts[1]);
      this.pinch.lastMidX = (ts[0].clientX + ts[1].clientX) / 2;
      this.pinch.lastMidY = (ts[0].clientY + ts[1].clientY) / 2;
    }, { passive: false });

    window.addEventListener("touchcancel", () => {
      clearLongPress();
      stopMomentum();
      this.drag.active = false;
      this.pinch.active = false;
      this.touch.startedOnCanvas = false;
    }, { passive: true });

    window.addEventListener("touchmove", (e) => {
      if (!this.touch.startedOnCanvas) return;
      const ts = e.touches;
      if (!ts || ts.length === 0) return;

      // Any significant movement cancels the long-press timer.
      if (ts.length === 1) {
        const t = ts[0];
        const moveDist = Math.hypot(
          t.clientX - this.touch.startX,
          t.clientY - this.touch.startY,
        );
        if (moveDist > TAP_THRESHOLD_PX) clearLongPress();
      }

      if (ts.length >= 2) {
        // If the gesture didn't start on the canvas, don't treat it as a pinch.
        // Without this guard, a 2-finger gesture that begins on non-canvas UI
        // (e.g. header inputs) can cause a large zoom jump because pinch.lastDist
        // was never initialised (Issue #40, 31-Dec-2025).
        if (!this.pinch.active) return;

        clearLongPress();

        // Prevent the browser from treating gestures as scroll/back/zoom when
        // the user is manipulating the canvas.
        e.preventDefault();

        // Pinch zoom toward the midpoint between fingers (#106).
        const d = touchDistance(ts[0], ts[1]);
        const dd = this.pinch.lastDist - d;
        this.pinch.lastDist = d;

        const mx = (ts[0].clientX + ts[1].clientX) / 2;
        const my = (ts[0].clientY + ts[1].clientY) / 2;

        // Zoom toward the pinch midpoint rather than canvas centre (#106).
        const rect = c.getBoundingClientRect();
        const localMx = mx - rect.left;
        const localMy = my - rect.top;
        const pz = pinchZoomToward(
          localMx,
          localMy,
          rect.width,
          rect.height,
          dd * 0.22,
        );
        this.zoomBy(pz.zoom);

        // Apply the focal-point pan correction.
        const focalRx = Math.cos(this.yaw);
        const focalRz = -Math.sin(this.yaw);
        this.pos.x += focalRx * pz.panX;
        this.pos.z += focalRz * pz.panX;
        this.pos.y -= pz.panY;

        // Two-finger pan: drag the midpoint to translate the camera. This is
        // the touch equivalent of WASD/arrow movement and lets users pan back
        // toward centre without a keyboard (Issue #41, 31-Dec-2025).
        const dx = mx - this.pinch.lastMidX;
        const dy = my - this.pinch.lastMidY;
        this.pinch.lastMidX = mx;
        this.pinch.lastMidY = my;

        // Track velocity for momentum (#106).
        this.pinch.lastVx = dx;
        this.pinch.lastVy = dy;

        // Right vector from yaw only (keeps strafe intuitive, same as keyboard).
        const rx = Math.cos(this.yaw);
        const rz = -Math.sin(this.yaw);

        // Scale with distance so panning feels usable at any zoom level.
        const dist = Math.hypot(this.pos.x, this.pos.y, this.pos.z);
        const panScale = Math.max(0.05, dist * 0.002);

        // Match "drag the world" intuition: moving fingers right moves the view
        // right (camera moves left), moving fingers down moves view down.
        this.pos.x -= rx * dx * panScale;
        this.pos.z -= rz * dx * panScale;
        this.pos.y += dy * panScale;
        return;
      }

      // Single-finger look.
      if (!this.drag.active) return;

      // Prevent the browser from treating gestures as scroll/back/zoom when the
      // user is manipulating the canvas.
      e.preventDefault();

      const t = ts[0];
      const dx = t.clientX - this.drag.lastX;
      const dy = t.clientY - this.drag.lastY;
      this.drag.lastX = t.clientX;
      this.drag.lastY = t.clientY;
      this.yaw += dx * 0.005;
      this.pitch += dy * 0.005;
      this.pitch = clamp(this.pitch, -1.35, 1.35);
    }, { passive: false });

    window.addEventListener("keydown", (e) => {
      // Support discrete zoom steps on key press. This helps users who don't
      // have a wheel/trackpad handy (or are using keyboard-only navigation).
      // Note: zoomBy() is along the current view direction.
      const t = /** @type {any} */ (e.target);
      const tag = String(t?.tagName ?? "").toLowerCase();
      if (tag !== "input" && tag !== "textarea") {
        const k = String(e.key ?? "").toLowerCase();
        // Larger step so a single key press is visible.
        if (k === "+" || k === "=" || k === "]") this.zoomBy(-180);
        if (k === "-" || k === "_" || k === "[") this.zoomBy(180);
        if (k === "z") this.zoomToFocus(70);
      }
      this.keys.add(e.key.toLowerCase());
    });
    window.addEventListener("keyup", (e) => {
      this.keys.delete(e.key.toLowerCase());
    });

    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.zoomBy(e.deltaY * 0.09);
    }, { passive: false });

    // Desktop click handler — touch devices use tap classification above (#106).
    c.addEventListener("click", (e) => {
      // Skip synthetic click events from touch (handled by touchend tap logic).
      if (this._lastTouchEnd && performance.now() - this._lastTouchEnd < 400) {
        return;
      }
      if (!this.positions || !this.meta?.length) return;
      const idx = this.pickStarIndex(e.clientX, e.clientY);
      if (idx < 0) return;
      // Only allow clicking neurons connected to the current focus (Issue #50).
      // Skip check if no focus set yet (initial click) or if callback not configured.
      if (this.focusIndex >= 0 && this.isConnectedToFocus) {
        if (!this.isConnectedToFocus(idx)) return;
      }
      this.setFocus(idx);
    });

    // Track last touch end time to suppress synthesised click events (#106).
    window.addEventListener("touchend", () => {
      this._lastTouchEnd = performance.now();
    }, { passive: true });
  }

  getForwardVector() {
    // Forward vector (yaw/pitch) in camera space.
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    return { x: sy * cp, y: -sp, z: cy * cp };
  }

  clampDistance(minDist, maxDist) {
    const d = Math.hypot(this.pos.x, this.pos.y, this.pos.z);
    if (!Number.isFinite(d) || d <= 1e-9) return;
    if (d < minDist) {
      const s = minDist / d;
      this.pos.x *= s;
      this.pos.y *= s;
      this.pos.z *= s;
    } else if (d > maxDist) {
      const s = maxDist / d;
      this.pos.x *= s;
      this.pos.y *= s;
      this.pos.z *= s;
    }
  }

  zoomBy(delta) {
    // Zoom along the current view direction, not world Z. This makes zoom feel
    // correct after yaw/pitch and helps users "open up" the neighbourhood view
    // to see linked neurons (Issue #39, 31-Dec-2025).
    const f = this.getForwardVector();
    this.pos.x += f.x * delta;
    this.pos.y += f.y * delta;
    this.pos.z += f.z * delta;

    // Allow a wider zoom range than the original 520 limit.
    this.clampDistance(20, 1400);
  }

  zoomToFocus(distance = 70) {
    // Zoom the camera to the focused neuron so the cell body + nucleus are
    // readable without manual fiddling (Issue #44, 1-Jan-2026).
    //
    // In focus-centric layouts, the focus is at/near the origin, but we still
    // use the current focus position so this works for alternate layouts.
    let fx = 0;
    let fy = 0;
    let fz = 0;
    const idx = this.focusIndex ?? -1;
    if (idx >= 0 && this.positions) {
      fx = this.positions[idx * 3 + 0] ?? 0;
      fy = this.positions[idx * 3 + 1] ?? 0;
      fz = this.positions[idx * 3 + 2] ?? 0;
    }

    // Reset view direction so the user gets a stable, repeatable close-up.
    this.yaw = 0;
    this.pitch = 0;
    this.pos.x = fx;
    this.pos.y = fy;
    this.pos.z = fz + distance;
    this.clampDistance(20, 1400);
  }

  /**
   * Animate the camera along a synapse path to a target position (Issue #50).
   * Creates a smooth traveling effect when navigating between neurons.
   * @param {number} targetX - Target X position (typically 0 for focus-centric layout)
   * @param {number} targetY - Target Y position
   * @param {number} targetZ - Target Z position
   * @param {number} duration - Animation duration in ms
   */
  animateCameraTo(targetX, targetY, targetZ, duration = TRAVEL_DURATION) {
    // Cancel any existing animation.
    if (this.travelAnimation) {
      cancelAnimationFrame(this.travelAnimation.rafId);
      this.travelAnimation = null;
    }

    const startX = this.pos.x;
    const startY = this.pos.y;
    const startZ = this.pos.z;
    const startYaw = this.yaw;
    const startPitch = this.pitch;
    const startTime = performance.now();

    const animate = (now) => {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / duration);
      const e = easing(t);

      // Interpolate camera position along synapse path.
      this.pos.x = lerp(startX, targetX, e);
      this.pos.y = lerp(startY, targetY, e);
      this.pos.z = lerp(startZ, targetZ, e);

      // Smoothly reset yaw/pitch to 0 for stable arrival.
      this.yaw = lerp(startYaw, 0, e);
      this.pitch = lerp(startPitch, 0, e);

      if (t < 1) {
        this.travelAnimation = {
          rafId: requestAnimationFrame(animate),
        };
      } else {
        this.travelAnimation = null;
      }
    };

    this.travelAnimation = {
      rafId: requestAnimationFrame(animate),
    };
  }

  /**
   * Travel along synapse to the new focus (Issue #50).
   * Call this before resetting camera to create the traveling effect.
   * @param {number} distance - Final camera distance from focus
   */
  travelAlongSynapse(distance = 110) {
    // For focus-centric layouts, target is always near origin.
    // The traveling effect animates from current camera position to the reset position.
    this.animateCameraTo(0, 0, distance, TRAVEL_DURATION);
  }

  setData({
    positions,
    colours,
    sizes,
    glyphs,
    bias,
    types,
    warn,
    inDeg,
    outDeg,
    vis,
    meta,
  }) {
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

    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufGlyph);
    gl.bufferData(gl.ARRAY_BUFFER, glyphs, gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufBias);
    gl.bufferData(gl.ARRAY_BUFFER, bias, gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufType);
    gl.bufferData(gl.ARRAY_BUFFER, types, gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufWarn);
    gl.bufferData(gl.ARRAY_BUFFER, warn, gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufInDeg);
    gl.bufferData(gl.ARRAY_BUFFER, inDeg, gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufOutDeg);
    gl.bufferData(gl.ARRAY_BUFFER, outDeg, gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufVis);
    gl.bufferData(gl.ARRAY_BUFFER, vis, gl.DYNAMIC_DRAW);
  }

  updateVisibility(vis) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufVis);
    gl.bufferData(gl.ARRAY_BUFFER, vis, gl.DYNAMIC_DRAW);
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

  updateSynapses({ positions, dirs, sides, widths, colours }) {
    const gl = this.gl;
    this.synVertCount = Math.floor(positions.length / 3);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufSynPos);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufSynDir);
    gl.bufferData(gl.ARRAY_BUFFER, dirs, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufSynSide);
    gl.bufferData(gl.ARRAY_BUFFER, sides, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufSynWidth);
    gl.bufferData(gl.ARRAY_BUFFER, widths, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufSynCol);
    gl.bufferData(gl.ARRAY_BUFFER, colours, gl.DYNAMIC_DRAW);
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

    // Draw synapse ribbons next.
    if (this.synVertCount > 0) {
      gl.useProgram(this.synProgram);
      gl.uniformMatrix4fv(this.synUProj, false, proj);
      gl.uniformMatrix4fv(this.synUView, false, view);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform2f(this.synUViewport, this.canvas.width, this.canvas.height);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufSynPos);
      gl.enableVertexAttribArray(this.synAPos);
      gl.vertexAttribPointer(this.synAPos, 3, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufSynDir);
      gl.enableVertexAttribArray(this.synADir);
      gl.vertexAttribPointer(this.synADir, 3, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufSynSide);
      gl.enableVertexAttribArray(this.synASide);
      gl.vertexAttribPointer(this.synASide, 1, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufSynWidth);
      gl.enableVertexAttribArray(this.synAWidth);
      gl.vertexAttribPointer(this.synAWidth, 1, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufSynCol);
      gl.enableVertexAttribArray(this.synACol);
      gl.vertexAttribPointer(this.synACol, 4, gl.FLOAT, false, 0, 0);

      gl.drawArrays(gl.TRIANGLES, 0, this.synVertCount);
    }

    // Then draw neurons.
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uProj, false, proj);
    gl.uniformMatrix4fv(this.uView, false, view);
    gl.uniform1f(this.uPixelRatio, this.pixelRatio);
    gl.uniform1f(this.uGlyphStyle, this.glyphStyle01);
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

    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufGlyph);
    gl.enableVertexAttribArray(this.aGlyph);
    gl.vertexAttribPointer(this.aGlyph, 1, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufBias);
    gl.enableVertexAttribArray(this.aBias);
    gl.vertexAttribPointer(this.aBias, 1, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufType);
    gl.enableVertexAttribArray(this.aType);
    gl.vertexAttribPointer(this.aType, 1, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufWarn);
    gl.enableVertexAttribArray(this.aWarn);
    gl.vertexAttribPointer(this.aWarn, 1, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufInDeg);
    gl.enableVertexAttribArray(this.aInDeg);
    gl.vertexAttribPointer(this.aInDeg, 1, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufOutDeg);
    gl.enableVertexAttribArray(this.aOutDeg);
    gl.vertexAttribPointer(this.aOutDeg, 1, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufVis);
    gl.enableVertexAttribArray(this.aVis);
    gl.vertexAttribPointer(this.aVis, 1, gl.FLOAT, false, 0, 0);

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
    const prevIdx = this.focusIndex;
    const prevMeta = prevIdx >= 0 ? (this.meta[prevIdx] ?? null) : null;
    this.focusIndex = idx;
    this.updateFocusFlag(idx);
    this.onFocusChanged?.(idx, this.meta[idx] ?? null, prevIdx, prevMeta);
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

/** @type {string[]} */
let focusTrail = [];
/** @type {string[]} */
let outputPathToFocus = [];
let inboundTotalCount = 0;
let inboundRenderedCount = 0;

function updateBackButtonState() {
  const btn = el.backBtn;
  if (!(btn instanceof HTMLButtonElement)) return;
  btn.disabled = focusTrail.length < 2;
}

function focusTrailTitle() {
  if (!focusTrail.length) return "";
  // Newest last (the current focus is at the end).
  return `\n\nHistory: ${focusTrail.join(" → ")}`;
}

function normaliseFocusTrailForCurrentFocus(focusUuid) {
  if (!focusUuid) return;
  if (!focusTrail.length) {
    focusTrail = [focusUuid];
    return;
  }
  // If the user jumps to a non-neighbour (not linked by any synapse), reset the
  // trail. This keeps the "path home" meaningful for NEAT navigation, where the
  // user generally traverses synapses step-by-step.
  const prevUuid = focusTrail[focusTrail.length - 1] ?? null;
  if (prevUuid && adjacency) {
    const prevNeigh = adjacency.get(String(prevUuid)) ?? new Set();
    if (!prevNeigh.has(String(focusUuid))) {
      focusTrail = [focusUuid];
      return;
    }
  }
  // Keep the current focus as the last element.
  const last = focusTrail[focusTrail.length - 1];
  if (last !== focusUuid) focusTrail.push(focusUuid);
  if (focusTrail.length > MAX_FOCUS_TRAIL) {
    focusTrail = focusTrail.slice(-MAX_FOCUS_TRAIL);
  }
}

function navigateBack() {
  if (!renderer || !points) return false;
  if (focusTrail.length < 2) return false;

  // Remove current focus and go to the previous.
  focusTrail.pop();
  const targetUuid = focusTrail[focusTrail.length - 1] ?? null;
  if (!targetUuid) return false;

  const idx = points.indexByUuid.get(String(targetUuid));
  if (idx == null) return false;

  renderer.setFocus(idx);
  updateBackButtonState();
  return true;
}

function getTrailIndexPairs() {
  if (!points || focusTrail.length < 2) return [];
  /** @type {{ ia: number, ib: number, aUuid: string, bUuid: string }[]} */
  const out = [];
  for (let i = 0; i < focusTrail.length - 1; i++) {
    const a = focusTrail[i] ?? null;
    const b = focusTrail[i + 1] ?? null;
    if (!a || !b) continue;
    const ia = points.indexByUuid.get(String(a));
    const ib = points.indexByUuid.get(String(b));
    if (ia == null || ib == null) continue;
    out.push({ ia, ib, aUuid: String(a), bUuid: String(b) });
  }
  return out;
}

function appendTrailLines({ linePos, lineCol, p, c, positions, alpha = 0.55 }) {
  const pairs = getTrailIndexPairs();
  if (!pairs.length) return { p, c };
  // "You are here" cyan, but only when the focus trail step corresponds to an
  // actual synapse. This keeps the overlay faithful to the NEAT graph.
  const base = [0.35, 0.95, 1.0];
  for (const { ia, ib, aUuid, bUuid } of pairs) {
    const info = edgeInfoBetween(edgeByDir, aUuid, bUuid);
    if (!info) continue;

    const ax = positions[ia * 3 + 0];
    const ay = positions[ia * 3 + 1];
    const az = positions[ia * 3 + 2];
    const bx = positions[ib * 3 + 0];
    const by = positions[ib * 3 + 1];
    const bz = positions[ib * 3 + 2];

    linePos[p++] = ax;
    linePos[p++] = ay;
    linePos[p++] = az;
    linePos[p++] = bx;
    linePos[p++] = by;
    linePos[p++] = bz;

    for (let k = 0; k < 2; k++) {
      lineCol[c++] = base[0];
      lineCol[c++] = base[1];
      lineCol[c++] = base[2];
      // Slightly scale alpha by edge strength so the trail feels "synapse-like".
      const s01 = edgeStrength01(info);
      lineCol[c++] = alpha * (0.6 + 0.4 * s01);
    }
  }
  return { p, c };
}

// ============================================================================
// Synapse ribbons (v2)
// ============================================================================

// Use a small fixed segment count so cables read as curved without blowing up
// the GL line budget (inbound edges are already capped).
const CURVE_SEGMENTS = 8;

function appendCurvedEdge({
  linePos,
  lineCol,
  p,
  c,
  ax,
  ay,
  az,
  bx,
  by,
  bz,
  col, // [r,g,b,a]
  bend01, // 0..1
  bendSign, // -1 or +1
}) {
  // Control point: bend sideways in XY, plus a little Z lift so it reads in 3D.
  const mx = (ax + bx) * 0.5;
  const my = (ay + by) * 0.5;
  const mz = (az + bz) * 0.5;

  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;

  // Perp in XY (stable even if dz dominates).
  const lenXY = Math.hypot(dx, dy);
  const px = lenXY > 1e-6 ? (-dy / lenXY) : 1;
  const py = lenXY > 1e-6 ? (dx / lenXY) : 0;

  const chord = Math.hypot(dx, dy, dz);
  const bend = chord * (0.08 + 0.22 * bend01) * bendSign;

  const cx = mx + px * bend;
  const cy = my + py * bend;
  const cz = mz + 0.10 * chord * bend01;

  let lastX = ax;
  let lastY = ay;
  let lastZ = az;

  for (let s = 1; s <= CURVE_SEGMENTS; s++) {
    const t = s / CURVE_SEGMENTS;
    const it = 1 - t;
    // Quadratic Bezier: (1-t)^2 A + 2(1-t)t C + t^2 B
    const x = it * it * ax + 2 * it * t * cx + t * t * bx;
    const y = it * it * ay + 2 * it * t * cy + t * t * by;
    const z = it * it * az + 2 * it * t * cz + t * t * bz;

    linePos[p++] = lastX;
    linePos[p++] = lastY;
    linePos[p++] = lastZ;
    linePos[p++] = x;
    linePos[p++] = y;
    linePos[p++] = z;

    for (let k = 0; k < 2; k++) {
      lineCol[c++] = col[0];
      lineCol[c++] = col[1];
      lineCol[c++] = col[2];
      lineCol[c++] = col[3];
    }

    lastX = x;
    lastY = y;
    lastZ = z;
  }

  return { p, c };
}

function appendSynapseRibbonSegment({
  pos,
  dir,
  side,
  width,
  col,
  p,
  d,
  s,
  w,
  c,
  ax,
  ay,
  az,
  bx,
  by,
  bz,
  widthPx,
  rgba,
}) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;

  // Two triangles for the segment, expanded in shader using aSide (+/-1).
  // Triangle 1: A-, A+, B-
  // Triangle 2: B-, A+, B+
  const push = (x, y, z, sx) => {
    pos[p++] = x;
    pos[p++] = y;
    pos[p++] = z;
    dir[d++] = dx;
    dir[d++] = dy;
    dir[d++] = dz;
    side[s++] = sx;
    width[w++] = widthPx;
    col[c++] = rgba[0];
    col[c++] = rgba[1];
    col[c++] = rgba[2];
    col[c++] = rgba[3];
    return { p, d, s, w, c };
  };

  ({ p, d, s, w, c } = push(ax, ay, az, -1.0));
  ({ p, d, s, w, c } = push(ax, ay, az, +1.0));
  ({ p, d, s, w, c } = push(bx, by, bz, -1.0));

  ({ p, d, s, w, c } = push(bx, by, bz, -1.0));
  ({ p, d, s, w, c } = push(ax, ay, az, +1.0));
  ({ p, d, s, w, c } = push(bx, by, bz, +1.0));

  return { p, d, s, w, c };
}

function appendSynapseRibbon({
  pos,
  dir,
  side,
  width,
  col,
  p,
  d,
  s,
  w,
  c,
  ax,
  ay,
  az,
  bx,
  by,
  bz,
  rgba, // [r,g,b,a]
  bend01, // 0..1
  bendSign, // -1 or +1
  widthPx,
}) {
  // Quadratic bezier control point (same curve as appendCurvedEdge).
  const mx = (ax + bx) * 0.5;
  const my = (ay + by) * 0.5;
  const mz = (az + bz) * 0.5;

  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;

  const lenXY = Math.hypot(dx, dy);
  const px = lenXY > 1e-6 ? (-dy / lenXY) : 1;
  const py = lenXY > 1e-6 ? (dx / lenXY) : 0;

  const chord = Math.hypot(dx, dy, dz);
  const bend = chord * (0.08 + 0.22 * bend01) * bendSign;

  const cx = mx + px * bend;
  const cy = my + py * bend;
  const cz = mz + 0.10 * chord * bend01;

  let lastX = ax;
  let lastY = ay;
  let lastZ = az;

  for (let seg = 1; seg <= CURVE_SEGMENTS; seg++) {
    const t = seg / CURVE_SEGMENTS;
    const it = 1 - t;
    const x = it * it * ax + 2 * it * t * cx + t * t * bx;
    const y = it * it * ay + 2 * it * t * cy + t * t * by;
    const z = it * it * az + 2 * it * t * cz + t * t * bz;

    ({ p, d, s, w, c } = appendSynapseRibbonSegment({
      pos,
      dir,
      side,
      width,
      col,
      p,
      d,
      s,
      w,
      c,
      ax: lastX,
      ay: lastY,
      az: lastZ,
      bx: x,
      by: y,
      bz: z,
      widthPx,
      rgba,
    }));

    lastX = x;
    lastY = y;
    lastZ = z;
  }

  return { p, d, s, w, c };
}

function appendOutputPathLines({
  linePos,
  lineCol,
  p,
  c,
  positions,
  pathUuids,
  alpha = 0.85,
}) {
  if (!points || !pathUuids?.length || pathUuids.length < 2) return { p, c };
  const base = [0.35, 0.95, 1.0]; // bright cyan "route"
  // Draw consecutive edges along the path.
  for (let i = 0; i < pathUuids.length - 1; i++) {
    const a = pathUuids[i];
    const b = pathUuids[i + 1];
    if (!a || !b) continue;
    const ia = points.indexByUuid.get(String(a));
    const ib = points.indexByUuid.get(String(b));
    if (ia == null || ib == null) continue;

    // Ensure this step is an actual synapse (in either direction).
    const info = edgeInfoBetween(edgeByDir, a, b);
    if (!info) continue;

    const ax = positions[ia * 3 + 0];
    const ay = positions[ia * 3 + 1];
    const az = positions[ia * 3 + 2];
    const bx = positions[ib * 3 + 0];
    const by = positions[ib * 3 + 1];
    const bz = positions[ib * 3 + 2];

    linePos[p++] = ax;
    linePos[p++] = ay;
    linePos[p++] = az;
    linePos[p++] = bx;
    linePos[p++] = by;
    linePos[p++] = bz;

    const s01 = edgeStrength01(info);
    const aOut = alpha * (0.7 + 0.3 * s01);
    for (let k = 0; k < 2; k++) {
      lineCol[c++] = base[0];
      lineCol[c++] = base[1];
      lineCol[c++] = base[2];
      lineCol[c++] = aOut;
    }
  }
  return { p, c };
}

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
      getFocusTrail: () => focusTrail.slice(),
      goBack: () => navigateBack(),
      getOutputPathToFocus: () => outputPathToFocus.slice(),
      // Check if a neuron (by uuid) can be clicked from the current focus (Issue #50).
      canFocusNeuron: (uuid) => {
        if (!adjacency || !renderer) return false;
        const focusIdx = renderer.focusIndex;
        if (focusIdx < 0) return true; // No current focus, allow any click
        const focusUuid = renderer.meta?.[focusIdx]?.uuid;
        if (!focusUuid || !uuid) return false;
        const neighbours = adjacency.get(focusUuid);
        return neighbours?.has(String(uuid)) ?? false;
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
  const body = el.hudBody;
  if (!body) return;
  body.textContent = String(s ?? "");
}

function isNarrowMobile() {
  try {
    return window.matchMedia?.("(max-width: 520px)")?.matches === true;
  } catch (_e) {
    return false;
  }
}

function setPanelCollapsed(panelEl, collapsed) {
  if (!(panelEl instanceof HTMLElement)) return;
  panelEl.classList.toggle("isCollapsed", !!collapsed);
}

function initPanels() {
  // On iPhone, default the legend to collapsed so it doesn't block interaction.
  // The user can re-open it via the Minimise/Expand button.
  if (isNarrowMobile()) setPanelCollapsed(el.legend, true);

  if (el.hudToggle instanceof HTMLButtonElement) {
    const update = () => {
      const collapsed = el.hud?.classList?.contains("isCollapsed");
      el.hudToggle.textContent = collapsed ? "Expand" : "Minimise";
      el.hudToggle.title = collapsed
        ? "Expand focus panel"
        : "Minimise focus panel";
      el.hudToggle.setAttribute("aria-label", el.hudToggle.title);
    };
    update();
    el.hudToggle.addEventListener("click", () => {
      const isCollapsed = el.hud?.classList?.contains("isCollapsed");
      setPanelCollapsed(el.hud, !isCollapsed);
      update();
    });
  }

  if (el.legendToggle instanceof HTMLButtonElement) {
    const update = () => {
      const collapsed = el.legend?.classList?.contains("isCollapsed");
      el.legendToggle.textContent = collapsed ? "Expand" : "Minimise";
      el.legendToggle.title = collapsed ? "Expand legend" : "Minimise legend";
      el.legendToggle.setAttribute("aria-label", el.legendToggle.title);
    };
    update();
    el.legendToggle.addEventListener("click", () => {
      const isCollapsed = el.legend?.classList?.contains("isCollapsed");
      setPanelCollapsed(el.legend, !isCollapsed);
      update();
    });
  }
}

function setFocusBadge(uuid) {
  if (!el.focusBadge) return;
  // Avoid stale hover tooltips when focus changes (or is cleared). The badge's
  // child spans don't always carry a `title`, so the outer element must be
  // cleared/updated consistently.
  el.focusBadge.title = "";
  if (!uuid) {
    el.focusBadge.textContent = "";
    return;
  }
  const alias = getAlias(uuid);
  const desc = getDescription(uuid);
  const title = desc ? `${uuid} — ${desc}` : uuid;
  el.focusBadge.title = title + focusTrailTitle();
  if (alias) {
    el.focusBadge.innerHTML = `<span class="alias">${
      escapeHtml(alias)
    }</span><span class="uuid">${escapeHtml(uuid)}</span>`;
  } else {
    el.focusBadge.textContent = uuid;
  }
}

/**
 * Briefly pulse the label of the newly focused neuron (#104).
 * Adds the CSS `focusPulse` class to the matching `.starLabel.isFocus` element,
 * then removes it after the animation completes. Skipped when reduced motion is
 * preferred.
 */
function triggerFocusPulse(_uuid) {
  if (prefersReducedMotion()) return;
  const root = el.labelOverlay;
  if (!root) return;
  const focusLabel = root.querySelector(".starLabel.isFocus");
  if (!focusLabel) return;
  focusLabel.classList.remove("focusPulse");
  // Force a reflow so the animation restarts if the class was already present.
  void focusLabel.offsetWidth;
  focusLabel.classList.add("focusPulse");
  setTimeout(() => focusLabel.classList.remove("focusPulse"), FOCUS_PULSE_MS);
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

  // Label a small, high-signal subset of nearby neurons only.
  //
  // The current focus already appears in the top-centre focus badge, so
  // rendering a second "focus label" over the star is visual duplication and
  // makes the view feel noisy (Issue #44, 31-Dec-2025).
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
  // Always include the (local tail of the) output->focus path so users can see
  // context without being drowned in hundreds of lines.
  const pathTail = outputPathToFocus.slice(-(FOCUS_MAX_DEPTH + 2));
  const want = Array.from(new Set([...pathTail, ...neigh]));

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

    const isFocus = false;
    const text = labelText(u);
    const title = getDescription(u) ? `${u} — ${getDescription(u)}` : u;
    // Depth-aware label styling: far neurons get smaller + fainter labels.
    // `p.depth` is NDC z in [-1, 1], where smaller tends to be closer.
    const depth01 = Math.min(1, Math.max(0, (p.depth + 1) / 2));
    const opacity = 0.15 + (1 - depth01) * 0.75;
    const scale = 0.72 + (1 - depth01) * 0.45;
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
      "No focus.\n\nTip: click a neuron to inspect it. The warmer/glowier neurons are more suspicious.",
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
  const synCounts = (() => {
    // Derived counts from the raw synapse list so we can debug "why does this
    // neuron show an axon / why so many rays?" in a snapshot-agnostic way.
    const syn = graph?.synapses ?? [];
    let inN = 0;
    let outN = 0;
    for (const s of syn) {
      if (!s) continue;
      if (s.toUuid === m.uuid) inN += 1;
      if (s.fromUuid === m.uuid) outN += 1;
    }
    return { inN, outN };
  })();
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
  lines.push(`Synapses: in=${synCounts.inN}  out=${synCounts.outN}`);
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

    // Keep the HUD honest: show the true inbound synapse count, and how many we
    // are rendering (noise-filtered) to avoid overwhelming the view.
    if (typeof inboundTotalCount === "number" && inboundTotalCount > 0) {
      const r = typeof inboundRenderedCount === "number"
        ? inboundRenderedCount
        : 0;
      lines.push(`Inbound: ${inboundTotalCount} (rendering ${r})`);
    }

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

  /** @type {(p: {totalBytes: number|null, receivedBytes: number}) => void} */
  const onProgress = (p) => {
    if (!p.totalBytes) {
      showProgress(true);
      return;
    }
    showProgress(false);
    updateProgress((p.receivedBytes / p.totalBytes) * 100);
  };

  try {
    const obj = await fetchSnapshotJson(url, { onProgress });
    hideProgress();
    return obj;
  } catch (e) {
    // Try fallback URLs when loading the default snapshot fails (Issue #93).
    // GitHub Pages can be blocked by CORS on some networks.
    if (String(url) === DEFAULT_SNAPSHOT_URL) {
      for (const fallback of SNAPSHOT_FALLBACK_URLS) {
        if (!fallback || fallback === url) continue;
        try {
          setStatus(`Trying fallback ${fallback}...`);
          const obj = await fetchSnapshotJson(fallback, { onProgress });
          hideProgress();
          return obj;
        } catch (_e2) {
          // Keep trying next fallback.
        }
      }
    }
    hideProgress();
    throw e;
  }
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

    // Build neuron points and feed the renderer.
    points = buildStarPoints({
      snapshot: obj,
      neuronsByUuid: graph.neuronsByUuid,
      synapses: graph.synapses,
    });

    const focusIdx = pickDefaultFocusIndex(points, graph.neuronsByUuid);
    const focusUuid = focusIdx >= 0 ? points.meta[focusIdx]?.uuid : null;
    focusTrail = focusUuid ? [focusUuid] : [];
    updateBackButtonState();
    const positions = computePositionsForFocus({
      points,
      adjacency,
      focusUuid,
      backUuid: null,
      maxDepth: FOCUS_MAX_DEPTH,
      ringStep: FOCUS_RING_STEP,
      farRadius: FOCUS_FAR_RADIUS,
    });
    renderer.setData({
      positions,
      colours: points.colours,
      sizes: points.sizes,
      glyphs: points.glyphs,
      bias: points.bias,
      types: points.types,
      warn: points.warn,
      inDeg: points.inDeg,
      outDeg: points.outDeg,
      vis: points.vis,
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

    // Keep the header aligned: once a snapshot is loaded, collapse the loader
    // controls (Fetch/Browse) unless the user re-opens them (Issue #37,
    // 31-Dec-2025).
    const details = document.getElementById("snapshotDetails");
    if (details instanceof HTMLDetailsElement) details.open = false;
  } catch (e) {
    hideProgress();
    setStatus(e?.message ?? String(e), "bad");
    console.error(e);

    // If load failed, keep the loader controls visible so the user can recover
    // quickly without hunting for the panel.
    const details = document.getElementById("snapshotDetails");
    if (details instanceof HTMLDetailsElement) details.open = true;
  }
}

function initStarfield() {
  // Hard-lock Starfield to dark mode for now.
  //
  // iPhone/Safari reports have shown the light theme can make stars/lines too
  // subtle to see, which defeats the purpose of this view. Locking dark mode
  // keeps contrast high and behaviour predictable while we iterate.
  try {
    document.documentElement.setAttribute("data-theme", "dark");
    const metas = document.querySelectorAll('meta[name="theme-color"]');
    for (const meta of metas) meta.setAttribute("content", "#0a0e1a");
  } catch (_e) {
    // No-op.
  }

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
          renderer.focusIndex,
          renderer.meta[renderer.focusIndex] ?? null,
        );
      }
    });
  }

  // Back (focus trail).
  if (el.backBtn instanceof HTMLButtonElement) {
    el.backBtn.addEventListener("click", () => {
      navigateBack();
    });
    updateBackButtonState();
  }
  // Zoom to focus.
  if (el.zoomBtn instanceof HTMLButtonElement) {
    el.zoomBtn.addEventListener("click", () => {
      renderer?.zoomToFocus?.(70);
    });
  }
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Backspace") return;
    // Don't steal Backspace when typing in inputs.
    const t = e.target;
    const tag = String(t?.tagName ?? "").toLowerCase();
    if (tag === "input" || tag === "textarea") return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    navigateBack();
  });

  if (!(el.canvas instanceof HTMLCanvasElement)) {
    throw new Error("Missing #glCanvas");
  }
  renderer = new StarfieldRenderer(el.canvas);
  // Default glyph style is neuron (1.0), set in the renderer constructor.
  renderer.glyphStyle01 = 1;
  exposeDebugApi();
  initPanels();

  // Restrict clicks to neurons connected to the current focus (Issue #50).
  // This helps users understand their navigation path and prevents confusion.
  renderer.isConnectedToFocus = (clickedIdx) => {
    if (!adjacency || !points) return true; // Allow click if no adjacency data
    const focusIdx = renderer.focusIndex;
    if (focusIdx < 0) return true; // No current focus, allow any click
    const focusUuid = renderer.meta?.[focusIdx]?.uuid;
    const clickedUuid = renderer.meta?.[clickedIdx]?.uuid;
    if (!focusUuid || !clickedUuid) return true;
    // Check if clicked neuron is in the adjacency set of the focus.
    const neighbours = adjacency.get(focusUuid);
    return neighbours?.has(clickedUuid) ?? false;
  };

  renderer.onFocusChanged = (idx, m, _prevIdx, prevMeta) => {
    // Re-centre the whole neighbourhood around the newly focused neuron.
    const focusUuid = m?.uuid ?? null;
    normaliseFocusTrailForCurrentFocus(focusUuid);
    updateBackButtonState();
    if (points && adjacency && focusUuid) {
      // Recompute the output->focus path before any downstream consumers read it.
      // This avoids stale visibility highlighting when changing focus quickly
      // (Issue #44, 1-Jan-2026).
      outputPathToFocus = (graph?.neuronsByUuid && inboundAdjacency)
        ? computeOutputPathToFocus({
          neuronsByUuid: graph.neuronsByUuid,
          inboundAdj: inboundAdjacency,
          focusUuid,
        })
        : [];
      // Keep only the local tail of the output->focus path (avoid clutter).
      // This keeps the path readable even when the focus is far upstream.
      outputPathToFocus = outputPathToFocus.slice(-(FOCUS_MAX_DEPTH + 2));

      // Visibility mask: keep the focus neighbourhood readable by fading the
      // rest of the network (Issue #44, 1-Jan-2026).
      if (points.vis && renderer?.updateVisibility) {
        points.vis.fill(0.08);
        const allocForVis = computeInboundAllocationForFocus(focusUuid);
        const inboundForVis = selectInboundEdgesForRender(
          allocForVis.rows,
          focusUuid,
        );
        const pathTail = outputPathToFocus;
        const trail = focusTrail.slice(-Math.min(8, focusTrail.length));
        const want = new Set([focusUuid, ...pathTail, ...trail]);
        for (const r of inboundForVis) want.add(r.fromUuid);
        for (const u of want) {
          const i = points.indexByUuid.get(String(u));
          if (i != null) points.vis[i] = 1.0;
        }
        renderer.updateVisibility(points.vis);
      }

      const backUuid = (focusTrail.length >= 2)
        ? (focusTrail[focusTrail.length - 2] ?? null)
        : (prevMeta?.uuid ?? null);
      // Paths mode needs both the upstream positions (for rendering) and the BFS
      // distances (for selecting which upstream edges to render). Computing the
      // upstream layout is relatively expensive, so do it once and reuse.
      const upstreamLayout = viewMode === "paths" && inboundAdjacency
        ? computePositionsForUpstream({
          points,
          inboundAdj: inboundAdjacency,
          focusUuid,
          backUuid,
          maxDepth: UPSTREAM_MAX_DEPTH,
          ringStep: FOCUS_RING_STEP,
          farRadius: FOCUS_FAR_RADIUS,
        })
        : null;

      const positions = upstreamLayout
        ? upstreamLayout.positions
        : computePositionsForFocus({
          points,
          adjacency,
          focusUuid,
          backUuid,
          maxDepth: FOCUS_MAX_DEPTH,
          ringStep: FOCUS_RING_STEP,
          farRadius: FOCUS_FAR_RADIUS,
        });
      renderer.updatePositions(positions);
      // Update synapse lines: show (1) top inbound synapses into focus, and (2)
      // the output->focus path (shortest-hop route) for context.
      if (edgeByDir) {
        if (upstreamLayout) {
          const alloc = computeInboundAllocationForFocus(focusUuid);
          inboundTotalCount = alloc.rows.length;
          const inbound = selectInboundEdgesForRender(alloc.rows, focusUuid);
          inboundRenderedCount = inbound.length;

          // Synapse ribbons (v2): render inbound synapses as thick lines
          // (triangles) so width is reliable in WebGL1.
          const synVertsPerEdge = CURVE_SEGMENTS * 6;
          const synVertCount = inbound.length * synVertsPerEdge;
          const synPos = new Float32Array(synVertCount * 3);
          const synDir = new Float32Array(synVertCount * 3);
          const synSide = new Float32Array(synVertCount);
          const synWidth = new Float32Array(synVertCount);
          const synCol = new Float32Array(synVertCount * 4);
          let sp = 0;
          let sd = 0;
          let ss = 0;
          let sw = 0;
          let sc = 0;

          // Reserve space for the output->focus path + trail (thin guide lines).
          const pathEdges = Math.max(0, outputPathToFocus.length - 1);
          const trailEdges = Math.max(0, getTrailIndexPairs().length);
          const linePos = new Float32Array(
            (pathEdges + trailEdges) * 2 * 3,
          );
          const lineCol = new Float32Array(
            (pathEdges + trailEdges) * 2 * 4,
          );
          let p = 0;
          let c = 0;

          // Inbound synapses: upstream -> focus (in upstream layout coords).
          for (const r of inbound) {
            const iFrom = points.indexByUuid.get(r.fromUuid);
            const iTo = points.indexByUuid.get(r.toUuid);
            if (iFrom == null || iTo == null) continue;

            const fx = upstreamLayout.positions[iFrom * 3 + 0];
            const fy = upstreamLayout.positions[iFrom * 3 + 1];
            const fz = upstreamLayout.positions[iFrom * 3 + 2];
            const tx = upstreamLayout.positions[iTo * 3 + 0];
            const ty = upstreamLayout.positions[iTo * 3 + 1];
            const tz = upstreamLayout.positions[iTo * 3 + 2];

            const positive = (r.weight ?? 0) >= 0;
            const base = positive ? [0.25, 0.95, 0.55] : [1.0, 0.35, 0.35];
            const s01 = clamp(Math.sqrt(Math.max(0, r.share ?? 0)) * 2.2, 0, 1);
            const a = 0.12 + 0.75 * s01;
            const h = hash32(`${r.fromUuid}→${r.toUuid}::bend`);
            const u = u32ToU01(h);
            const bendSign = (h & 1) === 0 ? -1 : 1;

            // Width mapping:
            // - Primary: |weight| * impact (signal strength)
            // - Kept bounded so a high fan-in output neuron remains readable.
            const fromImpact = impactsByUuid?.[r.fromUuid] ?? 0;
            const widthSignal = Math.abs(r.weight ?? 0) *
              Math.abs(fromImpact ?? 0);
            const widthPx = clamp(
              1.2 + 6.0 * Math.sqrt(widthSignal + 1e-12),
              1.2,
              7.0,
            );
            ({ p: sp, d: sd, s: ss, w: sw, c: sc } = appendSynapseRibbon({
              pos: synPos,
              dir: synDir,
              side: synSide,
              width: synWidth,
              col: synCol,
              p: sp,
              d: sd,
              s: ss,
              w: sw,
              c: sc,
              ax: fx,
              ay: fy,
              az: fz,
              bx: tx,
              by: ty,
              bz: tz,
              rgba: [base[0], base[1], base[2], a],
              bend01: u,
              bendSign,
              widthPx,
            }));
          }

          ({ p, c } = appendOutputPathLines({
            linePos,
            lineCol,
            p,
            c,
            positions: upstreamLayout.positions,
            pathUuids: outputPathToFocus,
            alpha: 0.95,
          }));
          ({ p, c } = appendTrailLines({
            linePos,
            lineCol,
            p,
            c,
            positions: upstreamLayout.positions,
            alpha: 0.55,
          }));
          renderer.updateLines(linePos.slice(0, p), lineCol.slice(0, c));
          renderer.updateSynapses({
            positions: synPos.slice(0, sp),
            dirs: synDir.slice(0, sd),
            sides: synSide.slice(0, ss),
            widths: synWidth.slice(0, sw),
            colours: synCol.slice(0, sc),
          });
        } else {
          const alloc = computeInboundAllocationForFocus(focusUuid);
          inboundTotalCount = alloc.rows.length;
          const inbound = selectInboundEdgesForRender(alloc.rows, focusUuid);
          inboundRenderedCount = inbound.length;
          const synVertsPerEdge = CURVE_SEGMENTS * 6;
          const synVertCount = inbound.length * synVertsPerEdge;
          const synPos = new Float32Array(synVertCount * 3);
          const synDir = new Float32Array(synVertCount * 3);
          const synSide = new Float32Array(synVertCount);
          const synWidth = new Float32Array(synVertCount);
          const synCol = new Float32Array(synVertCount * 4);
          let sp = 0;
          let sd = 0;
          let ss = 0;
          let sw = 0;
          let sc = 0;
          const pathEdges = Math.max(0, outputPathToFocus.length - 1);
          const trailEdges = Math.max(0, getTrailIndexPairs().length);

          const linePos = new Float32Array(
            (pathEdges + trailEdges) * 2 * 3,
          );
          const lineCol = new Float32Array(
            (pathEdges + trailEdges) * 2 * 4,
          );
          let p = 0;
          let c = 0;

          // Max absolute weight for colour normalisation (#105).
          const maxAbsW = inbound.reduce(
            (mx, e) => Math.max(mx, Math.abs(e.weight ?? 0)),
            1,
          );

          // Inbound synapses: focus origin -> upstream node.
          for (const r of inbound) {
            const j = points.indexByUuid.get(r.fromUuid);
            if (j == null) continue;
            const x = positions[j * 3 + 0];
            const y = positions[j * 3 + 1];
            const z = positions[j * 3 + 2];

            const base = synapseWeightColourRgb01(r.weight ?? 0, maxAbsW);
            const s01 = clamp(Math.sqrt(Math.max(0, r.share ?? 0)) * 2.2, 0, 1);
            const a = 0.12 + 0.75 * s01;
            const h = hash32(`${r.fromUuid}→${r.toUuid}::bend`);
            const u = u32ToU01(h);
            const bendSign = (h & 1) === 0 ? -1 : 1;

            const fromImpact = impactsByUuid?.[r.fromUuid] ?? 0;
            const widthSignal = Math.abs(r.weight ?? 0) *
              Math.abs(fromImpact ?? 0);
            const widthPx = clamp(
              1.2 + 6.0 * Math.sqrt(widthSignal + 1e-12),
              1.2,
              7.0,
            );
            ({ p: sp, d: sd, s: ss, w: sw, c: sc } = appendSynapseRibbon({
              pos: synPos,
              dir: synDir,
              side: synSide,
              width: synWidth,
              col: synCol,
              p: sp,
              d: sd,
              s: ss,
              w: sw,
              c: sc,
              ax: 0,
              ay: 0,
              az: 0,
              bx: x,
              by: y,
              bz: z,
              rgba: [base[0], base[1], base[2], a],
              bend01: u,
              bendSign,
              widthPx,
            }));
          }

          ({ p, c } = appendOutputPathLines({
            linePos,
            lineCol,
            p,
            c,
            positions,
            pathUuids: outputPathToFocus,
            alpha: 0.95,
          }));
          ({ p, c } = appendTrailLines({
            linePos,
            lineCol,
            p,
            c,
            positions,
            alpha: 0.55,
          }));
          renderer.updateLines(linePos.slice(0, p), lineCol.slice(0, c));
          renderer.updateSynapses({
            positions: synPos.slice(0, sp),
            dirs: synDir.slice(0, sd),
            sides: synSide.slice(0, ss),
            widths: synWidth.slice(0, sw),
            colours: synCol.slice(0, sc),
          });
        }
      }
      // Animate camera traveling along synapse to new focus (Issue #50).
      // Skip animation when the user prefers reduced motion (#104).
      if (!prefersReducedMotion()) {
        renderer.travelAlongSynapse();
      } else {
        // Instant snap: position the camera at the target directly.
        renderer.pos.x = 0;
        renderer.pos.y = 0;
        renderer.pos.z = 110;
        renderer.yaw = 0;
        renderer.pitch = 0;
      }
    }
    setFocusBadge(focusUuid);
    triggerFocusPulse(focusUuid);
    updateLabelsForFocus(focusUuid, { force: true });
    buildHudForIndex(idx);
  };
  buildHudForIndex(-1);

  // Long-press shows the HUD tooltip for a neuron without focusing (#106).
  renderer.onLongPress = (idx, _m, _cx, _cy) => {
    buildHudForIndex(idx);
  };

  // Swipe left/right cycles through neurons in the focus trail (#106).
  renderer.onSwipe = (direction) => {
    if (!points || !renderer) return;
    if (direction === "left") {
      // Swipe left: advance forward in the trail (next neighbour).
      const focusUuid = renderer.meta?.[renderer.focusIndex]?.uuid ?? null;
      if (!focusUuid || !adjacency) return;
      const neighbours = Array.from(adjacency.get(String(focusUuid)) ?? []);
      // Pick the first non-trail neighbour as a "next" candidate.
      const trailSet = new Set(focusTrail);
      const next = neighbours.find((u) => !trailSet.has(u));
      if (!next) return;
      const idx = points.indexByUuid.get(String(next));
      if (idx != null) renderer.setFocus(idx);
    } else if (direction === "right") {
      // Swipe right: go back in the trail.
      navigateBack();
    }
  };

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

  // Boot with default snapshot, with top-level retry (Issue #118).
  // The first fetch can fail due to Service Worker activation timing or
  // transient network issues. This outer retry loop gives the system more
  // time to settle before giving up.
  async function autoLoadWithRetry(url, label) {
    for (let attempt = 0; attempt <= AUTO_LOAD_MAX_RETRIES; attempt++) {
      await loadSnapshot(url, label);
      if (SNAPSHOT) return; // Success — snapshot was populated.

      if (attempt < AUTO_LOAD_MAX_RETRIES) {
        const delay = AUTO_LOAD_RETRY_DELAY_MS * Math.pow(2, attempt);
        const secs = Math.round(delay / 1000);
        setStatus(`Load failed — retrying in ${secs}s...`, "warn");
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  el.fetchUrl.value = DEFAULT_SNAPSHOT_URL;
  autoLoadWithRetry(DEFAULT_SNAPSHOT_URL, DEFAULT_SNAPSHOT_URL).catch((e) => {
    setStatus(e.message ?? "Auto-load failed", "bad");
    console.error("Auto-load failed:", e);
  });

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
