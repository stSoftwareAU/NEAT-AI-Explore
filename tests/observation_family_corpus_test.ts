/**
 * Observation family derivation over the published snapshot's labels
 * (Issue #539).
 *
 * The bundled `docs/tooltips.json` is a byte-for-byte copy of the default
 * snapshot's `tooltips` map, so it is the real corpus the Sankey's layer 0 is
 * built from — and it carries no `group` metadata at all. Before #539 the
 * label fallback returned the whole label, so every observation became its own
 * "family" (~2,132 singletons on the published snapshot).
 *
 * These tests pin the two properties the aggregated model depends on:
 *  - the corpus collapses to a readable number of families, and
 *  - no observation is dropped on the way (Score conservation).
 */

import { assert, assertEquals } from "./test_helpers.ts";

import {
  groupObservationsByFamily,
  UNGROUPED_FAMILY_KEY,
} from "../docs/shared/observation_families.js";

interface TooltipEntry {
  label?: string;
  description?: string;
  group?: string;
}

const tooltips: Record<string, TooltipEntry> = JSON.parse(
  await Deno.readTextFile(new URL("../docs/tooltips.json", import.meta.url)),
);

const uuids = Object.keys(tooltips);
const labels: Record<string, string> = {};
for (const [uuid, entry] of Object.entries(tooltips)) {
  if (typeof entry?.label === "string") labels[uuid] = entry.label;
}

/**
 * Upper bound on the derived family count.
 *
 * The corpus is ~2,509 observations. The derivation is structural — it groups
 * by the leading subject token of the label — so the count tracks the number
 * of distinct underlying series, not the number of observations. The bound is
 * generous enough to absorb snapshot churn but tight enough that a regression
 * re-exploding the families (or a new dialect the derivation cannot read)
 * fails before merge.
 */
const MAX_FAMILIES = 400;

Deno.test("published snapshot labels collapse to a readable family count", () => {
  const families = groupObservationsByFamily({ uuids, labels });

  assert(
    families.length <= MAX_FAMILIES,
    `expected at most ${MAX_FAMILIES} families, got ${families.length}`,
  );
  assert(
    families.length >= 20,
    `expected the corpus to keep real structure, got ${families.length} families`,
  );
  // At least a five-fold collapse — the pre-#539 derivation was 1:1.
  assert(
    families.length * 5 <= uuids.length,
    `expected a >=5x collapse of ${uuids.length} observations, got ${families.length} families`,
  );
});

Deno.test("no observation is dropped when the corpus is grouped", () => {
  const families = groupObservationsByFamily({ uuids, labels });

  const total = families.reduce((sum, f) => sum + f.memberCount, 0);
  assertEquals(total, uuids.length);

  const members = new Set(families.flatMap((f) => f.members));
  assertEquals(members.size, uuids.length);
  for (const uuid of uuids) {
    assert(members.has(uuid), `observation ${uuid} lost its family`);
  }
});

Deno.test("the corpus yields recognisable, well-populated families", () => {
  const families = groupObservationsByFamily({ uuids, labels });
  const byKey = new Map(families.map((f) => [f.key, f]));

  // The dialects present in the published labels: hyphenated technical series
  // ("close-best-fit-30-7"), prose fundamentals ("Treasury 2Y mean 28D") and
  // ratio labels ("P/E ratio (TTM)").
  for (const key of ["close", "volume", "treasury", "sentiment", "dividend"]) {
    const family = byKey.get(key);
    assert(family !== undefined, `expected a "${key}" family`);
    assert(
      (family?.memberCount ?? 0) >= 10,
      `expected "${key}" to aggregate many observations, got ${family?.memberCount}`,
    );
  }

  // Ratio labels keep their identity rather than collapsing into a bare "p".
  assert(byKey.has("p-e"), 'expected a "p-e" family for P/E ratio labels');
  assert(!byKey.has("p"), 'did not expect a meaningless "p" family');

  // Every label is usable, so nothing lands in the ungrouped bucket.
  assertEquals(byKey.get(UNGROUPED_FAMILY_KEY), undefined);
});

Deno.test("grouping the corpus is deterministic", () => {
  const first = groupObservationsByFamily({ uuids, labels });
  const second = groupObservationsByFamily({ uuids, labels });
  assertEquals(JSON.stringify(first), JSON.stringify(second));

  const keys = first.map((f) => f.key);
  assertEquals(JSON.stringify(keys), JSON.stringify(keys.slice().sort()));
});
