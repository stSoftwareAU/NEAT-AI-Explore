/**
 * Observation family grouping tests (Issue #524).
 *
 * The aggregated layered graph model groups thousands of input observations
 * into a handful of families before any view renders them. These tests pin
 * the derivation rules (group metadata wins, label fallback, ungrouped
 * default) and the determinism/identity guarantees the model relies on.
 */

import { assert, assertEquals } from "./test_helpers.ts";

import {
  deriveObservationFamily,
  groupObservationsByFamily,
  normaliseFamilyKey,
  UNGROUPED_FAMILY_KEY,
} from "../docs/shared/observation_families.js";

Deno.test("normaliseFamilyKey slugifies a display label", () => {
  assertEquals(normaliseFamilyKey("Interest Rates"), "interest-rates");
  assertEquals(normaliseFamilyKey("  RATES  "), "rates");
  assertEquals(normaliseFamilyKey("AU/NZ macro"), "au-nz-macro");
  assertEquals(normaliseFamilyKey(""), "");
  assertEquals(normaliseFamilyKey(null), "");
});

Deno.test("deriveObservationFamily prefers the tooltip group", () => {
  const family = deriveObservationFamily({
    uuid: "input-0",
    label: "Cash rate — RBA target",
    group: "rates",
  });
  assertEquals(family.key, "rates");
  assertEquals(family.label, "rates");
});

Deno.test("deriveObservationFamily falls back to the label's leading segment", () => {
  assertEquals(
    deriveObservationFamily({ uuid: "input-1", label: "ASX:BHP close" }).key,
    "asx",
  );
  assertEquals(
    deriveObservationFamily({ uuid: "input-2", label: "Momentum — 30 day" })
      .label,
    "Momentum",
  );
  assertEquals(
    deriveObservationFamily({ uuid: "input-3", label: "Volume" }).key,
    "volume",
  );
});

Deno.test("deriveObservationFamily reads the published label dialects (Issue #539)", () => {
  // Hyphenated technical series — the trailing window/offset is a modifier.
  assertEquals(
    deriveObservationFamily({ uuid: "input-0", label: "divYieldYr-0" }).key,
    "divyieldyr",
  );
  assertEquals(
    deriveObservationFamily({ uuid: "input-1", label: "close-best-fit-0-180" })
      .key,
    "close",
  );
  assertEquals(
    deriveObservationFamily({
      uuid: "input-2",
      label: "retail_sales-best-fit-6",
    })
      .key,
    "retail",
  );
  // Series code plus statistic, separated by spaces.
  assertEquals(
    deriveObservationFamily({ uuid: "input-3", label: "EMVMACROTRADE mean 9M" })
      .key,
    "emvmacrotrade",
  );
  assertEquals(
    deriveObservationFamily({ uuid: "input-4", label: "Treasury 2Y mean 28D" })
      .label,
    "Treasury",
  );
  // Prose fundamentals with a bracketed qualifier.
  assertEquals(
    deriveObservationFamily({
      uuid: "input-5",
      label: "Cash ratio trend (20 quarters)",
    }).key,
    "cash",
  );
});

Deno.test("deriveObservationFamily keeps ratio labels intact (Issue #539)", () => {
  // "/" is part of the subject, not a separator: P/E, P/B and P/FCF are
  // distinct families rather than one meaningless "p".
  assertEquals(
    deriveObservationFamily({
      uuid: "input-6",
      label: "P/FCF ratio (TTM) trend (2 quarters)",
    }).key,
    "p-fcf",
  );
  assertEquals(
    deriveObservationFamily({ uuid: "input-7", label: "P/E ratio (TTM)" })
      .label,
    "P/E",
  );
});

Deno.test("deriveObservationFamily skips leading tokens with no letters or digits", () => {
  assertEquals(
    deriveObservationFamily({ uuid: "input-8", label: "— Momentum 30 day" })
      .key,
    "momentum",
  );
  assertEquals(
    deriveObservationFamily({ uuid: "input-9", label: "  ---  " }).key,
    UNGROUPED_FAMILY_KEY,
  );
});

Deno.test("deriveObservationFamily returns the ungrouped family with no metadata", () => {
  const family = deriveObservationFamily({ uuid: "input-9" });
  assertEquals(family.key, UNGROUPED_FAMILY_KEY);
  assertEquals(family.label, "ungrouped");
});

Deno.test("groupObservationsByFamily buckets observations and keeps members", () => {
  const families = groupObservationsByFamily({
    uuids: ["input-0", "input-1", "input-2", "input-3"],
    groups: { "input-0": "rates", "input-1": "rates", "input-2": "equities" },
    labels: { "input-3": "Volume" },
  });

  assertEquals(
    families.map((f) => f.key).join(","),
    "equities,rates,volume",
  );
  const rates = families.find((f) => f.key === "rates");
  assertEquals(rates?.members.join(","), "input-0,input-1");
  assertEquals(rates?.memberCount, 2);
});

Deno.test("groupObservationsByFamily is deterministic across repeated calls", () => {
  const uuids = ["input-2", "input-0", "input-1"];
  const groups = { "input-0": "rates", "input-1": "equities" };
  const first = groupObservationsByFamily({ uuids, groups });
  const second = groupObservationsByFamily({ uuids, groups });
  assertEquals(JSON.stringify(first), JSON.stringify(second));
  // Members keep the caller's ordering so aggregate identity is stable.
  assertEquals(
    first.find((f) => f.key === UNGROUPED_FAMILY_KEY)?.members.join(","),
    "input-2",
  );
});

Deno.test("groupObservationsByFamily accepts a custom derivation for per-stock views", () => {
  const families = groupObservationsByFamily({
    uuids: ["input-0", "input-1"],
    labels: { "input-0": "BHP close", "input-1": "BHP volume" },
    deriveFamily: ({ label }) => {
      const parts = String(label ?? "").split(" ");
      return { key: parts[0].toLowerCase(), label: parts[0] };
    },
  });
  assertEquals(families.length, 1);
  assertEquals(families[0].key, "bhp");
  assertEquals(families[0].members.join(","), "input-0,input-1");
});

Deno.test("groupObservationsByFamily ignores non-string uuids", () => {
  const families = groupObservationsByFamily({
    uuids: ["input-0", "", null, 7],
    groups: { "input-0": "rates" },
  });
  assertEquals(families.length, 1);
  assert(families[0].members.every((m) => typeof m === "string"));
});
