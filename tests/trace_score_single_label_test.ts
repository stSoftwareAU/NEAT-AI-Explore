/**
 * Regression tests for Issue #247 — the Trace Explorer breadcrumb must
 * render the "Score:" label exactly once.
 *
 * Pre-fix state: `docs/app.js` carried plumbing for a second score badge
 * (`#tracePathScore` / `#tracePathScoreValue` / `updateTracePathScoreUI`)
 * alongside the canonical `#traceScore` badge wired by `renderTraceScore`.
 * The duplicate plumbing was never paired with an HTML element, but it
 * left dead lookups, a dead update function, and call sites that risked
 * regressing into a real duplicate.
 *
 * This test pins the user-visible contract: the trace bar markup carries
 * exactly one score badge and no retired path-score element. It asserts on
 * the rendered structure (element counts) rather than on the spelling of
 * helper names inside `docs/app.js`, so a behaviour-preserving refactor of
 * the app (renaming helpers, caching handles, inlining functions) cannot
 * break it while a genuine duplicate badge still can — regardless of the
 * id or helper name used to introduce it.
 *
 * Issue #310: a prior companion test grepped the source text of
 * `docs/app.js` for JavaScript symbol names (`updateTracePathScoreUI`,
 * `renderTraceScore(`, `getElementById("traceScore")`). That was a
 * HOW-assertion over source text — it pinned implementation internals,
 * obstructed safe refactoring, and would have let a differently-named
 * duplicate slip through. It was removed because the structural assertions
 * below cover the same contract behaviourally.
 */

import { assert, assertEquals } from "./test_helpers.ts";
import { loadIndexDocument } from "./dom_helpers.ts";

Deno.test("index.html exposes exactly one Score badge inside the trace bar (Issue #247)", async () => {
  const doc = await loadIndexDocument();

  // Scope to the <nav class="traceBar"> block so we only count Score
  // indicators that sit on the breadcrumb line.
  const traceBar = doc.querySelector("nav.traceBar");
  assert(traceBar, 'Expected <nav class="traceBar"> block in index.html');

  // Exactly one canonical score badge by id.
  assertEquals(
    traceBar.querySelectorAll("#traceScore").length,
    1,
    "Expected exactly one #traceScore element inside the trace bar",
  );

  // Exactly one score badge by class. Counting the class (not just the
  // canonical id) catches a future duplicate introduced under a different
  // id — the failure mode the retired source-grep test could not detect.
  assertEquals(
    traceBar.querySelectorAll(".traceScore").length,
    1,
    "Expected exactly one .traceScore badge inside the trace bar",
  );

  // No duplicate path-score badge.
  assertEquals(
    traceBar.querySelector("#tracePathScore"),
    null,
    "Expected no #tracePathScore element inside the trace bar (Issue #247)",
  );
  assertEquals(
    traceBar.querySelector("#tracePathScoreValue"),
    null,
    "Expected no #tracePathScoreValue element inside the trace bar (Issue #247)",
  );
});
