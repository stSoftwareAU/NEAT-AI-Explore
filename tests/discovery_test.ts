/**
 * Tests for discovery candidate normalisation (docs/shared/discovery.js).
 *
 * These are "what" tests: import the module, call functions with test data,
 * assert results.
 */

import {
  extractDiscoveryCandidates,
  normaliseCandidate,
} from "../docs/shared/discovery.js";
import { assert, assertEquals } from "./test_helpers.ts";

// ---------------------------------------------------------------------------
// normaliseCandidate
// ---------------------------------------------------------------------------

Deno.test("normaliseCandidate returns null for null input", () => {
  assertEquals(normaliseCandidate(null, 0), null);
});

Deno.test("normaliseCandidate returns null for non-object input", () => {
  assertEquals(normaliseCandidate("string" as unknown as null, 0), null);
  assertEquals(normaliseCandidate(42 as unknown as null, 1), null);
});

Deno.test("normaliseCandidate extracts camelCase fields", () => {
  const raw = {
    type: "addSynapse",
    fromUuid: "input-0",
    toUuid: "hidden-1",
    oldWeight: 0.5,
    expectedScoreGain: 0.1,
  };
  const result = normaliseCandidate(raw, 0)!;
  assertEquals(result.type, "addSynapse");
  assertEquals(result.fromUuid, "input-0");
  assertEquals(result.toUuid, "hidden-1");
  assertEquals(result.oldWeight, 0.5);
  assertEquals(result.expectedScoreGain, 0.1);
});

Deno.test("normaliseCandidate extracts snake_case fields", () => {
  const raw = {
    candidate_type: "split",
    from_uuid: "input-0",
    to_uuid: "output-0",
    old_weight: 1.5,
    expected_score_gain: -0.2,
  };
  const result = normaliseCandidate(raw, 0)!;
  assertEquals(result.type, "split");
  assertEquals(result.fromUuid, "input-0");
  assertEquals(result.toUuid, "output-0");
  assertEquals(result.oldWeight, 1.5);
  assertEquals(result.expectedScoreGain, -0.2);
});

Deno.test("normaliseCandidate extracts nested synapse fields", () => {
  const raw = {
    type: "modify",
    synapse: { fromUuid: "hidden-0", toUuid: "output-0", weight: 2.0 },
  };
  const result = normaliseCandidate(raw, 0)!;
  assertEquals(result.fromUuid, "hidden-0");
  assertEquals(result.toUuid, "output-0");
  assertEquals(result.oldWeight, 2.0);
});

Deno.test("normaliseCandidate handles newWeights array", () => {
  const raw = {
    type: "adjust",
    fromUuid: "input-0",
    toUuid: "output-0",
    newWeights: [1.5, 2.5],
  };
  const result = normaliseCandidate(raw, 0)!;
  assertEquals(result.newWeightA, 1.5);
  assertEquals(result.newWeightB, 2.5);
});

Deno.test("normaliseCandidate handles explicit new weight fields", () => {
  const raw = {
    type: "adjust",
    fromUuid: "input-0",
    toUuid: "output-0",
    newWeightA: 3.0,
    newWeightB: 4.0,
  };
  const result = normaliseCandidate(raw, 0)!;
  assertEquals(result.newWeightA, 3.0);
  assertEquals(result.newWeightB, 4.0);
});

Deno.test("normaliseCandidate handles w1/w2 shorthand", () => {
  const raw = {
    type: "adjust",
    fromUuid: "input-0",
    toUuid: "output-0",
    w1: 0.7,
    w2: 0.3,
  };
  const result = normaliseCandidate(raw, 0)!;
  assertEquals(result.newWeightA, 0.7);
  assertEquals(result.newWeightB, 0.3);
});

Deno.test("normaliseCandidate extracts new neuron info", () => {
  const raw = {
    type: "split",
    fromUuid: "input-0",
    toUuid: "output-0",
    newNeuron: { squash: "RELU", bias: 0.1 },
  };
  const result = normaliseCandidate(raw, 0)!;
  assertEquals(result.newNeuronSquash, "RELU");
  assertEquals(result.newNeuronBias, 0.1);
});

Deno.test("normaliseCandidate extracts neuron from insertedNeuron", () => {
  const raw = {
    type: "split",
    fromUuid: "input-0",
    toUuid: "output-0",
    insertedNeuron: { squash: "SIGMOID", bias: -0.5 },
  };
  const result = normaliseCandidate(raw, 0)!;
  assertEquals(result.newNeuronSquash, "SIGMOID");
  assertEquals(result.newNeuronBias, -0.5);
});

Deno.test("normaliseCandidate uses id for key when available", () => {
  const raw = { id: "my-id", fromUuid: "a", toUuid: "b" };
  const result = normaliseCandidate(raw, 5)!;
  assertEquals(result.key, "my-id");
});

Deno.test("normaliseCandidate uses uuid for key as fallback", () => {
  const raw = { uuid: "my-uuid", fromUuid: "a", toUuid: "b" };
  const result = normaliseCandidate(raw, 5)!;
  assertEquals(result.key, "my-uuid");
});

Deno.test("normaliseCandidate generates synthetic key when no id", () => {
  const raw = { type: "add", fromUuid: "input-0", toUuid: "output-0" };
  const result = normaliseCandidate(raw, 3)!;
  assertEquals(result.key, "add:input-0→output-0:3");
});

Deno.test("normaliseCandidate generates key with unknowns for missing uuids", () => {
  const raw = { type: "modify" };
  const result = normaliseCandidate(raw, 7)!;
  assertEquals(result.key, "modify:?→?:7");
});

Deno.test("normaliseCandidate extracts comment from various fields", () => {
  assertEquals(
    normaliseCandidate({ comment: "note A" }, 0)!.comment,
    "note A",
  );
  assertEquals(
    normaliseCandidate({ note: "note B" }, 0)!.comment,
    "note B",
  );
  assertEquals(
    normaliseCandidate({ diagnostics: "diag C" }, 0)!.comment,
    "diag C",
  );
});

Deno.test("normaliseCandidate preserves raw reference", () => {
  const raw = { type: "test" };
  const result = normaliseCandidate(raw, 0)!;
  assert(result.raw === raw);
});

Deno.test("normaliseCandidate returns null fields for missing data", () => {
  const raw = { type: "minimal" };
  const result = normaliseCandidate(raw, 0)!;
  assertEquals(result.fromUuid, null);
  assertEquals(result.toUuid, null);
  assertEquals(result.oldWeight, null);
  assertEquals(result.newWeightA, null);
  assertEquals(result.newWeightB, null);
  assertEquals(result.expectedScoreGain, null);
  assertEquals(result.expectedImpact, null);
  assertEquals(result.comment, null);
  assertEquals(result.newNeuronSquash, null);
  assertEquals(result.newNeuronBias, null);
});

Deno.test("normaliseCandidate ignores non-finite numeric fields", () => {
  const raw = {
    oldWeight: NaN,
    expectedScoreGain: Infinity,
    fromIndex: -Infinity,
  };
  const result = normaliseCandidate(raw, 0)!;
  assertEquals(result.oldWeight, null);
  assertEquals(result.expectedScoreGain, null);
  assertEquals(result.fromIndex, null);
});

Deno.test("normaliseCandidate ignores blank string fields", () => {
  const raw = { fromUuid: "  ", comment: "" };
  const result = normaliseCandidate(raw, 0)!;
  assertEquals(result.fromUuid, null);
  assertEquals(result.comment, null);
});

// ---------------------------------------------------------------------------
// extractDiscoveryCandidates
// ---------------------------------------------------------------------------

Deno.test("extractDiscoveryCandidates handles derived.candidates path", () => {
  const snapshot = {
    derived: {
      candidates: [
        { type: "add", fromUuid: "input-0", toUuid: "output-0" },
      ],
    },
  };
  const result = extractDiscoveryCandidates(snapshot);
  assertEquals(result.length, 1);
  assertEquals(result[0].type, "add");
});

Deno.test("extractDiscoveryCandidates handles derived.discoveryCandidates path", () => {
  const snapshot = {
    derived: {
      discoveryCandidates: [
        { type: "split", fromUuid: "a", toUuid: "b" },
      ],
    },
  };
  const result = extractDiscoveryCandidates(snapshot);
  assertEquals(result.length, 1);
  assertEquals(result[0].type, "split");
});

Deno.test("extractDiscoveryCandidates handles top-level candidates path", () => {
  const snapshot = {
    candidates: [
      { type: "modify", fromUuid: "x", toUuid: "y" },
    ],
  };
  const result = extractDiscoveryCandidates(snapshot);
  assertEquals(result.length, 1);
});

Deno.test("extractDiscoveryCandidates handles discovery.candidates path", () => {
  const snapshot = {
    discovery: {
      candidates: [
        { type: "test", fromUuid: "a", toUuid: "b" },
      ],
    },
  };
  const result = extractDiscoveryCandidates(snapshot);
  assertEquals(result.length, 1);
});

Deno.test("extractDiscoveryCandidates returns empty for null snapshot", () => {
  const result = extractDiscoveryCandidates(null as unknown as object);
  assertEquals(result.length, 0);
});

Deno.test("extractDiscoveryCandidates returns empty for empty snapshot", () => {
  const result = extractDiscoveryCandidates({});
  assertEquals(result.length, 0);
});

Deno.test("extractDiscoveryCandidates filters out invalid entries", () => {
  const snapshot = {
    candidates: [
      { type: "valid", fromUuid: "a", toUuid: "b" },
      null,
      "not-an-object",
      42,
      { type: "also-valid" },
    ],
  };
  const result = extractDiscoveryCandidates(snapshot);
  assertEquals(result.length, 2);
});

Deno.test("extractDiscoveryCandidates handles non-array candidates gracefully", () => {
  const snapshot = { candidates: "not-an-array" };
  const result = extractDiscoveryCandidates(
    snapshot as unknown as { candidates: unknown[] },
  );
  assertEquals(result.length, 0);
});
