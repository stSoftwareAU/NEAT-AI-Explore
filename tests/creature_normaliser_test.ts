/**
 * Tests for docs/shared/creature_normaliser.js (Issue #125).
 *
 * Exercises the pure normaliseCreature function that was previously duplicated
 * in app.js and graph.js.
 */

import { assert, assertEquals } from "./test_helpers.ts";
import { normaliseCreature } from "../docs/shared/creature_normaliser.js";

// ---------------------------------------------------------------------------
// Basic extraction
// ---------------------------------------------------------------------------

Deno.test("normaliseCreature – extracts creature from snapshot.creature", () => {
  const snapshot = {
    creature: {
      neurons: [{
        uuid: "output-0",
        type: "output",
        squash: "LOGISTIC",
        bias: 0.5,
      }],
      synapses: [{ fromUuid: "input-0", toUuid: "output-0", weight: 1.0 }],
      input: 1,
      output: 1,
    },
  };
  const result = normaliseCreature(snapshot);
  assertEquals(result.creature, snapshot.creature);
  assertEquals(result.neuronsByUuid.size, 2); // output-0 + synthetic input-0
  assertEquals(result.synapses.length, 1);
});

Deno.test("normaliseCreature – falls back to creatureJson", () => {
  const snapshot = {
    creatureJson: {
      neurons: [],
      synapses: [],
      input: 0,
      output: 0,
    },
  };
  const result = normaliseCreature(snapshot);
  assertEquals(result.creature, snapshot.creatureJson);
});

Deno.test("normaliseCreature – throws when no creature present", () => {
  let threw = false;
  try {
    normaliseCreature({});
  } catch (e) {
    threw = true;
    assert(e instanceof Error, "Expected Error instance");
    assert(
      e.message.includes("No creature in snapshot"),
      `Unexpected message: ${e.message}`,
    );
  }
  assert(threw, "Expected normaliseCreature({}) to throw");

  threw = false;
  try {
    normaliseCreature(null);
  } catch (e) {
    threw = true;
    assert(e instanceof Error, "Expected Error instance");
  }
  assert(threw, "Expected normaliseCreature(null) to throw");
});

// ---------------------------------------------------------------------------
// Synapse normalisation
// ---------------------------------------------------------------------------

Deno.test("normaliseCreature – normalises various UUID field names", () => {
  const snapshot = {
    creature: {
      neurons: [],
      synapses: [
        { fromUuid: "a", toUuid: "b", weight: 1 },
        { fromUUID: "c", toUUID: "d", weight: 2 },
        { from_uuid: "e", to_uuid: "f", weight: 3 },
      ],
      input: 0,
      output: 0,
    },
  };
  const result = normaliseCreature(snapshot);
  assertEquals(result.synapses.length, 3);
  assertEquals(result.synapses[0].fromUuid, "a");
  assertEquals(result.synapses[0].toUuid, "b");
  assertEquals(result.synapses[1].fromUuid, "c");
  assertEquals(result.synapses[1].toUuid, "d");
  assertEquals(result.synapses[2].fromUuid, "e");
  assertEquals(result.synapses[2].toUuid, "f");
});

Deno.test("normaliseCreature – filters invalid synapses", () => {
  const snapshot = {
    creature: {
      neurons: [],
      synapses: [
        { fromUuid: "a", toUuid: "b", weight: 1 },
        { fromUuid: null, toUuid: "b", weight: 1 },
        { fromUuid: "a", weight: 1 }, // missing toUuid
        { fromUuid: "a", toUuid: "b" }, // missing weight
        { fromUuid: "a", toUuid: "b", weight: "not-a-number" },
      ],
      input: 0,
      output: 0,
    },
  };
  const result = normaliseCreature(snapshot);
  assertEquals(result.synapses.length, 1);
});

// ---------------------------------------------------------------------------
// Synthetic input neurons
// ---------------------------------------------------------------------------

Deno.test("normaliseCreature – creates synthetic input neurons", () => {
  const snapshot = {
    creature: {
      neurons: [{
        uuid: "output-0",
        type: "output",
        squash: "LOGISTIC",
        bias: 0,
      }],
      synapses: [],
      input: 3,
      output: 1,
    },
  };
  const result = normaliseCreature(snapshot);
  // 1 real neuron + 3 synthetic inputs
  assertEquals(result.neuronsByUuid.size, 4);
  // deno-lint-ignore no-explicit-any
  const input1 = result.neuronsByUuid.get("input-1") as any;
  assertEquals(input1?.type, "input");
  assertEquals(input1?.squash, "IDENTITY");
  assertEquals(input1?.bias, 0);
});

Deno.test("normaliseCreature – does not overwrite existing input neurons", () => {
  const existingInput = {
    uuid: "input-0",
    type: "input",
    squash: "TANH",
    bias: 0.5,
  };
  const snapshot = {
    creature: {
      neurons: [existingInput],
      synapses: [],
      input: 1,
      output: 0,
    },
  };
  const result = normaliseCreature(snapshot);
  assertEquals(result.neuronsByUuid.get("input-0"), existingInput);
});

// ---------------------------------------------------------------------------
// Inbound index
// ---------------------------------------------------------------------------

Deno.test("normaliseCreature – builds inbound synapse index", () => {
  const snapshot = {
    creature: {
      neurons: [],
      synapses: [
        { fromUuid: "a", toUuid: "c", weight: 1 },
        { fromUuid: "b", toUuid: "c", weight: 2 },
        { fromUuid: "a", toUuid: "d", weight: 3 },
      ],
      input: 0,
      output: 0,
    },
  };
  const result = normaliseCreature(snapshot);
  assertEquals(result.inboundByTo.get("c")?.length, 2);
  assertEquals(result.inboundByTo.get("d")?.length, 1);
  assertEquals(result.inboundByTo.has("a"), false);
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

Deno.test("normaliseCreature – handles missing neurons/synapses arrays", () => {
  const snapshot = { creature: { input: 0, output: 0 } };
  const result = normaliseCreature(snapshot);
  assertEquals(result.synapses.length, 0);
  assertEquals(result.neuronsByUuid.size, 0);
});

Deno.test("normaliseCreature – handles non-array neurons/synapses", () => {
  const snapshot = {
    creature: { neurons: "bad", synapses: 42, input: 0, output: 0 },
  };
  const result = normaliseCreature(snapshot);
  assertEquals(result.synapses.length, 0);
  assertEquals(result.neuronsByUuid.size, 0);
});
