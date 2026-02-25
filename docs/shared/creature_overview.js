/**
 * Creature overview dashboard metric computations.
 *
 * Pure, DOM-free functions for computing summary statistics about a NEAT
 * creature's neural network. Used by the overview dashboard and tests.
 *
 * Australian English note:
 * - Prefer spellings like "behaviour" and "organisation".
 *
 * @module
 */

/**
 * @typedef {{ uuid: string, type: string, squash?: string, bias?: number }} Neuron
 * @typedef {{ fromUuid: string, toUuid: string, weight: number }} Synapse
 */

/**
 * Count neurons by type (input, hidden, output, constant).
 *
 * @param {Neuron[]} neurons
 * @returns {{ total: number, input: number, hidden: number, output: number, constant: number }}
 */
export function computeNeuronBreakdown(neurons) {
  const arr = Array.isArray(neurons) ? neurons : [];
  let input = 0;
  let hidden = 0;
  let output = 0;
  let constant = 0;
  for (const n of arr) {
    const t = n?.type;
    if (t === "input") input++;
    else if (t === "hidden") hidden++;
    else if (t === "output") output++;
    else if (t === "constant") constant++;
  }
  return { total: arr.length, input, hidden, output, constant };
}

/**
 * Compute synapse count and average connectivity.
 *
 * @param {Synapse[]} synapses
 * @param {number} neuronCount - total number of neurons
 * @returns {{ total: number, avgPerNeuron: number }}
 */
export function computeSynapseStats(synapses, neuronCount) {
  const arr = Array.isArray(synapses) ? synapses : [];
  const total = arr.length;
  const n = Math.max(0, Math.floor(neuronCount ?? 0));
  return {
    total,
    avgPerNeuron: n > 0 ? total / n : 0,
  };
}

/**
 * Compute network depth: the longest path from any input to any output.
 *
 * Uses BFS from each input node, following the directed synapse graph.
 * Returns the number of edges on the longest path found.
 *
 * @param {Synapse[]} synapses
 * @param {string[]} inputUuids
 * @param {string[]} outputUuids
 * @returns {number}
 */
export function computeNetworkDepth(synapses, inputUuids, outputUuids) {
  const arr = Array.isArray(synapses) ? synapses : [];
  const inputs = Array.isArray(inputUuids) ? inputUuids : [];
  const outputs = new Set(Array.isArray(outputUuids) ? outputUuids : []);

  if (arr.length === 0 || inputs.length === 0 || outputs.size === 0) return 0;

  // Build outgoing adjacency index.
  /** @type {Map<string, string[]>} */
  const outgoing = new Map();
  for (const s of arr) {
    const f = s?.fromUuid;
    const t = s?.toUuid;
    if (!f || !t) continue;
    if (!outgoing.has(f)) outgoing.set(f, []);
    outgoing.get(f).push(t);
  }

  // BFS from each input, tracking maximum depth to any output.
  let maxDepth = 0;
  for (const startUuid of inputs) {
    /** @type {Map<string, number>} */
    const dist = new Map();
    dist.set(startUuid, 0);
    const queue = [startUuid];

    while (queue.length > 0) {
      const cur = queue.shift();
      const curDist = dist.get(cur) ?? 0;
      const neighbours = outgoing.get(cur);
      if (!neighbours) continue;
      for (const next of neighbours) {
        const existing = dist.get(next);
        const newDist = curDist + 1;
        if (existing === undefined || newDist > existing) {
          dist.set(next, newDist);
          queue.push(next);
        }
      }
    }

    for (const oUuid of outputs) {
      const d = dist.get(oUuid);
      if (d !== undefined && d > maxDepth) maxDepth = d;
    }
  }

  return maxDepth;
}

/**
 * Count the distribution of activation (squash) functions across
 * non-input neurons.
 *
 * @param {Neuron[]} neurons
 * @returns {Map<string, number>}
 */
export function computeActivationDistribution(neurons) {
  /** @type {Map<string, number>} */
  const dist = new Map();
  const arr = Array.isArray(neurons) ? neurons : [];
  for (const n of arr) {
    if (n?.type === "input") continue;
    const squash = n?.squash ?? "UNKNOWN";
    dist.set(squash, (dist.get(squash) ?? 0) + 1);
  }
  return dist;
}

/**
 * @typedef {{ type: string, count: number, uuids: string[] }} Layer
 * @typedef {{ from: number, to: number, count: number }} TopologyEdge
 * @typedef {{ layers: Layer[], edges: TopologyEdge[] }} Topology
 */

/**
 * Compute a simplified layer topology for visualisation.
 *
 * Groups neurons into layers based on their topological depth from inputs.
 * Input neurons are layer 0; output neurons are the final layer; hidden
 * neurons are placed at the depth of their longest incoming path from an
 * input.
 *
 * @param {Neuron[]} neurons
 * @param {Synapse[]} synapses
 * @returns {Topology}
 */
export function computeLayerTopology(neurons, synapses) {
  const nArr = Array.isArray(neurons) ? neurons : [];
  const sArr = Array.isArray(synapses) ? synapses : [];

  if (nArr.length === 0) return { layers: [], edges: [] };

  const inputUuids = [];
  const outputUuids = [];
  const allUuids = new Set();

  for (const n of nArr) {
    const uuid = n?.uuid;
    if (!uuid) continue;
    allUuids.add(uuid);
    if (n.type === "input") inputUuids.push(uuid);
    else if (n.type === "output") outputUuids.push(uuid);
  }

  // Build outgoing adjacency.
  /** @type {Map<string, string[]>} */
  const outgoing = new Map();
  for (const s of sArr) {
    const f = s?.fromUuid;
    const t = s?.toUuid;
    if (!f || !t) continue;
    if (!outgoing.has(f)) outgoing.set(f, []);
    outgoing.get(f).push(t);
  }

  // Compute max depth from inputs via BFS (longest path).
  /** @type {Map<string, number>} */
  const depth = new Map();
  for (const uuid of inputUuids) depth.set(uuid, 0);
  const queue = [...inputUuids];

  while (queue.length > 0) {
    const cur = queue.shift();
    const curDepth = depth.get(cur) ?? 0;
    const neighbours = outgoing.get(cur);
    if (!neighbours) continue;
    for (const next of neighbours) {
      const existing = depth.get(next);
      const newDepth = curDepth + 1;
      if (existing === undefined || newDepth > existing) {
        depth.set(next, newDepth);
        queue.push(next);
      }
    }
  }

  // Group neurons by depth.
  /** @type {Map<number, { type: string, uuids: string[] }>} */
  const layerMap = new Map();
  const outputSet = new Set(outputUuids);

  for (const n of nArr) {
    const uuid = n?.uuid;
    if (!uuid) continue;
    const d = depth.get(uuid);
    if (d === undefined) continue; // unreachable from inputs
    if (!layerMap.has(d)) layerMap.set(d, { type: "hidden", uuids: [] });
    layerMap.get(d).uuids.push(uuid);
  }

  // Sort by depth and label layers.
  const sortedDepths = Array.from(layerMap.keys()).sort((a, b) => a - b);
  const layers = sortedDepths.map((d) => {
    const layer = layerMap.get(d);
    // Determine layer type by examining what's in it.
    let type = "hidden";
    if (d === 0) type = "input";
    else if (layer.uuids.some((u) => outputSet.has(u))) type = "output";
    return {
      type,
      count: layer.uuids.length,
      uuids: layer.uuids,
    };
  });

  // Build a uuid → layer-index lookup for edge computation.
  /** @type {Map<string, number>} */
  const uuidToLayerIndex = new Map();
  for (let li = 0; li < layers.length; li++) {
    for (const uuid of layers[li].uuids) {
      uuidToLayerIndex.set(uuid, li);
    }
  }

  // Count inter-layer edges (including skip connections).
  /** @type {Map<string, number>} key = "fromLayer→toLayer" */
  const edgeCounts = new Map();
  for (const s of sArr) {
    const f = s?.fromUuid;
    const t = s?.toUuid;
    if (!f || !t) continue;
    const fLayer = uuidToLayerIndex.get(f);
    const tLayer = uuidToLayerIndex.get(t);
    if (fLayer === undefined || tLayer === undefined) continue;
    if (fLayer === tLayer) continue; // intra-layer, skip
    const key = `${fLayer}→${tLayer}`;
    edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
  }

  /** @type {TopologyEdge[]} */
  const edges = [];
  for (const [key, count] of edgeCounts) {
    const [fromStr, toStr] = key.split("→");
    edges.push({ from: Number(fromStr), to: Number(toStr), count });
  }
  // Sort for deterministic output: by from, then by to.
  edges.sort((a, b) => a.from - b.from || a.to - b.to);

  return { layers, edges };
}
