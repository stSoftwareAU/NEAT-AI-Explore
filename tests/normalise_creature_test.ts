import { assert, assertEquals } from "./test_helpers.ts";

import { normaliseCreature } from "../docs/shared/snapshot_loader.js";

Deno.test("normaliseCreature extracts creature from snapshot.creature", () => {
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
  assertEquals(result.synapses[0].fromUuid, "input-0");
  assertEquals(result.synapses[0].toUuid, "output-0");
});

Deno.test("normaliseCreature falls back to creatureJson", () => {
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

Deno.test("normaliseCreature throws when no creature found", () => {
  let threw = false;
  try {
    normaliseCreature({});
  } catch (e) {
    threw = true;
    assert((e as Error).message.includes("No creature"));
  }
  assert(threw);
});

Deno.test("normaliseCreature normalises synapse UUID field names", () => {
  const snapshot = {
    creature: {
      neurons: [{
        uuid: "output-0",
        type: "output",
        squash: "LOGISTIC",
        bias: 0,
      }],
      synapses: [
        { fromUUID: "input-0", toUUID: "output-0", weight: 0.5 },
        { from_uuid: "input-1", to_uuid: "output-0", weight: -0.3 },
      ],
      input: 2,
      output: 1,
    },
  };
  const result = normaliseCreature(snapshot);
  assertEquals(result.synapses.length, 2);
  assertEquals(result.synapses[0].fromUuid, "input-0");
  assertEquals(result.synapses[1].fromUuid, "input-1");
});

Deno.test("normaliseCreature filters out invalid synapses", () => {
  const snapshot = {
    creature: {
      neurons: [],
      synapses: [
        { fromUuid: "a", toUuid: "b", weight: "not-a-number" },
        { fromUuid: "a", weight: 1.0 }, // missing toUuid
        { fromUuid: "a", toUuid: "b", weight: 1.0 }, // valid
      ],
      input: 0,
      output: 0,
    },
  };
  const result = normaliseCreature(snapshot);
  assertEquals(result.synapses.length, 1);
});

Deno.test("normaliseCreature creates synthetic input neurons", () => {
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
  assert(result.neuronsByUuid.has("input-0"));
  assert(result.neuronsByUuid.has("input-1"));
  assert(result.neuronsByUuid.has("input-2"));
  // deno-lint-ignore no-explicit-any
  const n0 = result.neuronsByUuid.get("input-0") as any;
  assertEquals(n0.type, "input");
  assertEquals(n0.squash, "IDENTITY");
});

Deno.test(
  "normaliseCreature does not overwrite existing input neurons",
  () => {
    const snapshot = {
      creature: {
        neurons: [
          {
            uuid: "input-0",
            type: "input",
            squash: "RELU",
            bias: 1.0,
          },
        ],
        synapses: [],
        input: 1,
        output: 0,
      },
    };
    const result = normaliseCreature(snapshot);
    // deno-lint-ignore no-explicit-any
    const n0 = result.neuronsByUuid.get("input-0") as any;
    assertEquals(n0.squash, "RELU");
  },
);

Deno.test("normaliseCreature builds inboundByTo index", () => {
  const snapshot = {
    creature: {
      neurons: [
        { uuid: "output-0", type: "output", squash: "LOGISTIC", bias: 0 },
      ],
      synapses: [
        { fromUuid: "input-0", toUuid: "output-0", weight: 1.0 },
        { fromUuid: "input-1", toUuid: "output-0", weight: -0.5 },
      ],
      input: 2,
      output: 1,
    },
  };
  const result = normaliseCreature(snapshot);
  const inbound = result.inboundByTo.get("output-0");
  assert(inbound !== undefined);
  assertEquals(inbound.length, 2);
});

Deno.test("normaliseCreature handles missing synapses array", () => {
  const snapshot = {
    creature: {
      neurons: [],
      input: 0,
      output: 0,
    },
  };
  const result = normaliseCreature(snapshot);
  assertEquals(result.synapses.length, 0);
});
