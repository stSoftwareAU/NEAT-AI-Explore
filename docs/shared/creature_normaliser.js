/**
 * Shared creature schema normalisation (Issue #125).
 *
 * Extracts the creature from a snapshot, normalises synapse UUID field names,
 * filters invalid synapses, synthesises missing input neurons, and builds
 * lookup indices — all as a pure function with no side effects.
 *
 * Previously duplicated (with slight differences) in app.js and graph.js.
 */

/**
 * @typedef {object} NormalisedCreature
 * @property {object} creature — the raw creature object from the snapshot.
 * @property {Map<string, object>} neuronsByUuid — neurons keyed by UUID
 *   (including synthetic input neurons).
 * @property {Array<{fromUuid: string, toUuid: string, weight: number}>} synapses
 *   — normalised synapse list (invalid entries filtered out).
 * @property {Map<string, Array<{fromUuid: string, toUuid: string, weight: number}>>} inboundByTo
 *   — synapses grouped by destination UUID for fast inbound traversal.
 */

/**
 * Normalise the creature from a snapshot into a consistent shape.
 *
 * @param {unknown} snapshot
 * @returns {NormalisedCreature}
 * @throws {Error} if no creature is found in the snapshot.
 */
export function normaliseCreature(snapshot) {
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

  // Synthesise input neurons that are referenced but not in the neuron list.
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

  // Index inbound synapses for fast traversal.
  /** @type {Map<string, Array<{fromUuid: string, toUuid: string, weight: number}>>} */
  const inboundByTo = new Map();
  for (const s of synapses) {
    if (!inboundByTo.has(s.toUuid)) inboundByTo.set(s.toUuid, []);
    inboundByTo.get(s.toUuid).push(s);
  }

  return { creature, neuronsByUuid, synapses, inboundByTo };
}
