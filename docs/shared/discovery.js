/**
 * Discovery candidate normalisation — pure computation, no DOM dependencies.
 *
 * Handles the varied schema formats that discovery snapshots may use across
 * different versions of NEAT-AI-Discovery.
 */

/**
 * Normalise a raw discovery candidate object into a consistent shape.
 *
 * Handles multiple field naming conventions (camelCase, snake_case, nested
 * synapse objects, etc.) so downstream code can rely on a single schema.
 *
 * @param {object|null} raw - The raw candidate object from the snapshot.
 * @param {number} idx - Index of the candidate in the source array (used for
 *   fallback key generation).
 * @returns {{ key: string, type: string, fromUuid: string|null, toUuid: string|null, fromIndex: number|null, toIndex: number|null, oldWeight: number|null, newWeightA: number|null, newWeightB: number|null, newNeuronSquash: string|null, newNeuronBias: number|null, expectedScoreGain: number|null, expectedImpact: number|null, comment: string|null, raw: object }|null} Normalised candidate or null if raw is invalid.
 */
export function normaliseCandidate(raw, idx) {
  if (!raw || typeof raw !== "object") return null;

  const type = String(
    raw.type ?? raw.kind ?? raw.candidateType ?? raw.candidate_type ?? "",
  ).trim();

  // Helper: safe nested getter by trying multiple field paths.
  function pick(...paths) {
    for (const p of paths) {
      const v = p(raw);
      if (v != null) return v;
    }
    return null;
  }

  function asStr(v) {
    return typeof v === "string" && v.trim() ? v.trim() : null;
  }

  function asNum(v) {
    return typeof v === "number" && isFinite(v) ? v : null;
  }

  const fromUuid = asStr(pick(
    (o) => o.fromUuid,
    (o) => o.from_uuid,
    (o) => o.fromUUID,
    (o) => o.synapse?.fromUuid,
    (o) => o.synapse?.from_uuid,
  ));
  const toUuid = asStr(pick(
    (o) => o.toUuid,
    (o) => o.to_uuid,
    (o) => o.toUUID,
    (o) => o.synapse?.toUuid,
    (o) => o.synapse?.to_uuid,
  ));

  const fromIndex = asNum(pick((o) => o.fromIndex, (o) => o.from_index));
  const toIndex = asNum(pick((o) => o.toIndex, (o) => o.to_index));

  const oldWeight = asNum(pick(
    (o) => o.oldWeight,
    (o) => o.old_weight,
    (o) => o.weight,
    (o) => o.synapse?.weight,
  ));

  // New weights: allow arrays or explicit fields.
  const newWeightsArr = pick((o) => o.newWeights, (o) => o.new_weights);
  const newWeightA = asNum(
    pick(
      (_o) => Array.isArray(newWeightsArr) ? newWeightsArr[0] : null,
      (o) => o.newWeightA,
      (o) => o.new_weight_a,
      (o) => o.w1,
    ),
  );
  const newWeightB = asNum(
    pick(
      (_o) => Array.isArray(newWeightsArr) ? newWeightsArr[1] : null,
      (o) => o.newWeightB,
      (o) => o.new_weight_b,
      (o) => o.w2,
    ),
  );

  const newNeuron = raw.newNeuron ?? raw.neuron ?? raw.insertedNeuron ??
    raw.inserted_neuron ?? null;
  const newNeuronSquash = asStr(
    newNeuron?.squash ?? raw.newNeuronSquash ?? raw.new_neuron_squash,
  );
  const newNeuronBias = asNum(
    newNeuron?.bias ?? raw.newNeuronBias ?? raw.new_neuron_bias,
  );

  const expectedScoreGain = asNum(
    pick(
      (o) => o.expectedScoreGain,
      (o) => o.expected_score_gain,
      (o) => o.scoreGain,
    ),
  );
  const expectedImpact = asNum(pick((o) => o.expectedImpact, (o) => o.impact));
  const comment = asStr(
    pick((o) => o.comment, (o) => o.note, (o) => o.diagnostics),
  );

  const key = asStr(raw.id) ??
    asStr(raw.uuid) ??
    `${type || "candidate"}:${fromUuid ?? "?"}→${toUuid ?? "?"}:${idx}`;

  return {
    key,
    type,
    fromUuid,
    toUuid,
    fromIndex,
    toIndex,
    oldWeight,
    newWeightA,
    newWeightB,
    newNeuronSquash,
    newNeuronBias,
    expectedScoreGain,
    expectedImpact,
    comment,
    raw,
  };
}

/**
 * Extract and normalise discovery candidates from a snapshot.
 *
 * Handles the many possible locations where candidates may appear in a
 * snapshot object (varied across NEAT-AI-Discovery versions).
 *
 * @param {object} snapshot - The full snapshot object.
 * @returns {{ key: string, type: string, fromUuid: string|null, toUuid: string|null, fromIndex: number|null, toIndex: number|null, oldWeight: number|null, newWeightA: number|null, newWeightB: number|null, newNeuronSquash: string|null, newNeuronBias: number|null, expectedScoreGain: number|null, expectedImpact: number|null, comment: string|null, raw: object }[]} Array of normalised candidate objects.
 */
export function extractDiscoveryCandidates(snapshot) {
  // Discovery snapshots have varied schema across versions. Keep this defensive.
  const candidates = snapshot?.derived?.candidates ??
    snapshot?.derived?.discoveryCandidates ??
    snapshot?.derived?.discovery_candidates ??
    snapshot?.discovery?.candidates ??
    snapshot?.discoveryCandidates ??
    snapshot?.candidates ??
    [];

  const arr = Array.isArray(candidates) ? candidates : [];
  return arr.map((c, idx) => normaliseCandidate(c, idx)).filter(Boolean);
}
