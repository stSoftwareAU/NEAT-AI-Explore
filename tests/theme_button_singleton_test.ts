/**
 * Regression test for Issue #204 — "Two theme buttons".
 *
 * The trace nav previously rendered a second hidden-by-default theme toggle
 * (`#themeToggleTrace`) alongside the JS-managed `#themeToggle` that
 * `syncThemeTogglePlacement()` moves out of the header on phone viewports.
 * On mobile both ended up inside `.traceButtons` and the user saw the
 * letter "A" twice.
 *
 * Fix: keep a single `#themeToggle` button and let the JS placement helper
 * move it between header and trace bar. This test parses the published
 * `docs/index.html` into a DOM and asserts the structural invariants of that
 * fix via semantic queries, so reordering attributes or renaming unrelated
 * classes cannot flag a refactor as a regression (Issue #312).
 */

import { assert, assertEquals } from "./test_helpers.ts";
import { loadIndexDocument } from "./dom_helpers.ts";

Deno.test("docs/index.html declares exactly one theme toggle button (Issue #204)", async () => {
  const doc = await loadIndexDocument();
  assertEquals(
    doc.querySelectorAll(".themeToggle").length,
    1,
    "Expected exactly one .themeToggle button in the rendered DOM",
  );
});

Deno.test("docs/index.html no longer ships #themeToggleTrace (Issue #204)", async () => {
  const doc = await loadIndexDocument();
  assertEquals(
    doc.getElementById("themeToggleTrace"),
    null,
    "Found stale #themeToggleTrace element — should have been removed when " +
      "consolidating onto the single JS-managed #themeToggle.",
  );
});

Deno.test("docs/index.html keeps the single #themeToggle button (Issue #204)", async () => {
  const doc = await loadIndexDocument();
  assert(
    doc.getElementById("themeToggle"),
    "The single #themeToggle button must remain — JS moves it between header " +
      "and trace bar based on viewport size.",
  );
});
