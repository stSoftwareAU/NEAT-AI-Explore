/**
 * Bundled observation tooltip fallback tests (Issue #521).
 *
 * The snapshot's embedded `tooltips` map is the source of truth. When a
 * snapshot predates that embedding, the viewer falls back to the copy of
 * GRQ's Tooltips.json bundled at `docs/tooltips.json`.
 */

import { assert, assertEquals } from "./test_helpers.ts";

import {
  fallbackTooltipsUrl,
  loadFallbackTooltips,
  mergeTooltipMaps,
  needsFallbackTooltips,
  resetFallbackTooltipsCache,
} from "../docs/shared/tooltips_fallback.js";

const BUNDLED = new URL("../docs/tooltips.json", import.meta.url);

// --- needsFallbackTooltips ---

Deno.test("needsFallbackTooltips is true when the snapshot carried no descriptions", () => {
  assertEquals(needsFallbackTooltips(null), true);
  assertEquals(needsFallbackTooltips({}), true);
  assertEquals(needsFallbackTooltips({ descriptions: {} }), true);
});

Deno.test("needsFallbackTooltips is false once a snapshot description exists", () => {
  assertEquals(
    needsFallbackTooltips({ descriptions: { "input-0": "Dividend yield" } }),
    false,
  );
});

// --- mergeTooltipMaps ---

Deno.test("mergeTooltipMaps lets the snapshot win over the bundled fallback", () => {
  const merged = mergeTooltipMaps(
    { "input-0": "From snapshot" },
    { "input-0": "From bundle", "input-1": "Bundle only" },
  );
  assertEquals(merged["input-0"], "From snapshot");
  assertEquals(merged["input-1"], "Bundle only");
});

Deno.test("mergeTooltipMaps tolerates missing maps", () => {
  // test_helpers.assertEquals is strict (===), so compare serialised shapes.
  assertEquals(JSON.stringify(mergeTooltipMaps(null, { a: "1" })), '{"a":"1"}');
  assertEquals(JSON.stringify(mergeTooltipMaps({ a: "1" }, null)), '{"a":"1"}');
  assertEquals(JSON.stringify(mergeTooltipMaps(null, null)), "{}");
});

// --- fallbackTooltipsUrl ---

Deno.test("fallbackTooltipsUrl resolves to docs/tooltips.json beside the shared modules", () => {
  const url = fallbackTooltipsUrl("https://example.test/shared/x.js");
  assertEquals(url, "https://example.test/tooltips.json");
});

// --- loadFallbackTooltips ---

Deno.test("loadFallbackTooltips returns label/description/group maps", async () => {
  resetFallbackTooltipsCache();
  const fetchImpl = () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          "input-0": { label: "divYieldYr-0", description: "Dividend yield" },
        }),
        { status: 200 },
      ),
    );
  const result = await loadFallbackTooltips({
    fetchImpl,
    url: "/tooltips.json",
  });
  assertEquals(result.labels["input-0"], "divYieldYr-0");
  assertEquals(result.descriptions["input-0"], "Dividend yield");
  resetFallbackTooltipsCache();
});

Deno.test("loadFallbackTooltips fetches once and reuses the cached result", async () => {
  resetFallbackTooltipsCache();
  let calls = 0;
  const fetchImpl = () => {
    calls += 1;
    return Promise.resolve(
      new Response(JSON.stringify({ "input-0": { description: "D" } }), {
        status: 200,
      }),
    );
  };
  await loadFallbackTooltips({ fetchImpl, url: "/tooltips.json" });
  await loadFallbackTooltips({ fetchImpl, url: "/tooltips.json" });
  assertEquals(calls, 1);
  resetFallbackTooltipsCache();
});

Deno.test("loadFallbackTooltips fails loudly on a non-OK response", async () => {
  resetFallbackTooltipsCache();
  const fetchImpl = () =>
    Promise.resolve(new Response("nope", { status: 404 }));
  let threw = false;
  try {
    await loadFallbackTooltips({ fetchImpl, url: "/tooltips.json" });
  } catch (err) {
    threw = true;
    assert(
      String(err).includes("404"),
      `error should name the HTTP status, got: ${err}`,
    );
  }
  assert(threw, "a missing bundled tooltips file must not be swallowed");
  resetFallbackTooltipsCache();
});

Deno.test("loadFallbackTooltips does not cache a failed fetch", async () => {
  resetFallbackTooltipsCache();
  let calls = 0;
  const failing = () => {
    calls += 1;
    return Promise.resolve(new Response("nope", { status: 500 }));
  };
  await loadFallbackTooltips({ fetchImpl: failing, url: "/t.json" }).catch(
    () => {},
  );
  await loadFallbackTooltips({ fetchImpl: failing, url: "/t.json" }).catch(
    () => {},
  );
  assertEquals(calls, 2);
  resetFallbackTooltipsCache();
});

Deno.test("loadFallbackTooltips rejects a non-object payload", async () => {
  resetFallbackTooltipsCache();
  const fetchImpl = () =>
    Promise.resolve(new Response(JSON.stringify([1, 2, 3]), { status: 200 }));
  let threw = false;
  try {
    await loadFallbackTooltips({ fetchImpl, url: "/t.json" });
  } catch {
    threw = true;
  }
  assert(threw, "a malformed tooltips payload must fail loudly");
  resetFallbackTooltipsCache();
});

// --- the bundled data itself ---

Deno.test("bundled docs/tooltips.json parses and carries observation descriptions", async () => {
  const raw = await Deno.readTextFile(BUNDLED);
  const parsed = JSON.parse(raw) as Record<
    string,
    { label?: string; description?: string }
  >;
  assert(
    typeof parsed === "object" && !Array.isArray(parsed),
    "bundled tooltips must be a uuid-keyed object",
  );
  const described = Object.entries(parsed).filter(([uuid, info]) =>
    uuid.startsWith("input-") && typeof info?.description === "string" &&
    info.description.trim().length > 0
  );
  assert(
    described.length > 100,
    `expected many observation descriptions, found ${described.length}`,
  );
});
