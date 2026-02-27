/**
 * Tests for docs/shared/alias_registry.js (Issue #125).
 *
 * Exercises the pure label/description extraction from snapshot tooltips.
 */

import { assertEquals } from "./test_helpers.ts";
import {
  buildAliasRegistry,
  getAlias,
  getDescription,
  getGroup,
} from "../docs/shared/alias_registry.js";

// ---------------------------------------------------------------------------
// buildAliasRegistry
// ---------------------------------------------------------------------------

Deno.test("buildAliasRegistry – extracts labels and descriptions", () => {
  const snapshot = {
    tooltips: {
      "input-0": { label: "Temperature", description: "Daily temperature" },
      "input-1": { label: "Humidity", description: "Relative humidity %" },
    },
  };
  const reg = buildAliasRegistry(snapshot);
  assertEquals(getAlias(reg, "input-0"), "Temperature");
  assertEquals(getDescription(reg, "input-0"), "Daily temperature");
  assertEquals(getAlias(reg, "input-1"), "Humidity");
});

Deno.test("buildAliasRegistry – falls back to meta.tooltips", () => {
  const snapshot = {
    meta: {
      tooltips: {
        "input-0": { label: "Price", description: "Asset price" },
      },
    },
  };
  const reg = buildAliasRegistry(snapshot);
  assertEquals(getAlias(reg, "input-0"), "Price");
});

Deno.test("buildAliasRegistry – extracts group from multiple field names", () => {
  const snapshot = {
    tooltips: {
      "input-0": { label: "A", group: "rates" },
      "input-1": { label: "B", category: "equities" },
      "input-2": { label: "C", domain: "macro" },
    },
  };
  const reg = buildAliasRegistry(snapshot);
  assertEquals(getGroup(reg, "input-0"), "rates");
  assertEquals(getGroup(reg, "input-1"), "equities");
  assertEquals(getGroup(reg, "input-2"), "macro");
});

Deno.test("buildAliasRegistry – returns null for missing entries", () => {
  const reg = buildAliasRegistry({});
  assertEquals(getAlias(reg, "input-0"), null);
  assertEquals(getDescription(reg, "input-0"), null);
  assertEquals(getGroup(reg, "input-0"), null);
});

Deno.test("buildAliasRegistry – skips invalid entries", () => {
  const snapshot = {
    tooltips: {
      "": { label: "Empty key" },
      "input-0": null,
      "input-1": "not-an-object",
      "input-2": { label: "" }, // empty label
      "input-3": { label: "  " }, // whitespace-only label
      "input-4": { label: "Valid" },
    },
  };
  const reg = buildAliasRegistry(snapshot);
  assertEquals(getAlias(reg, ""), null);
  assertEquals(getAlias(reg, "input-0"), null);
  assertEquals(getAlias(reg, "input-1"), null);
  assertEquals(getAlias(reg, "input-2"), null);
  assertEquals(getAlias(reg, "input-3"), null);
  assertEquals(getAlias(reg, "input-4"), "Valid");
});

Deno.test("buildAliasRegistry – trims label and description values", () => {
  const snapshot = {
    tooltips: {
      "input-0": { label: "  Padded  ", description: "  Desc  " },
    },
  };
  const reg = buildAliasRegistry(snapshot);
  assertEquals(getAlias(reg, "input-0"), "Padded");
  assertEquals(getDescription(reg, "input-0"), "Desc");
});

Deno.test("buildAliasRegistry – handles null/undefined snapshot", () => {
  assertEquals(getAlias(buildAliasRegistry(null), "x"), null);
  assertEquals(getAlias(buildAliasRegistry(undefined), "x"), null);
});
