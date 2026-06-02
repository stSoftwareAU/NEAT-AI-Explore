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

const HTML_PATH = new URL("../docs/index.html", import.meta.url);

async function loadHtml(): Promise<string> {
  return await Deno.readTextFile(HTML_PATH);
}

Deno.test("index.html exposes exactly one Score badge inside the trace bar (Issue #247)", async () => {
  const html = await loadHtml();

  // Extract the <nav class="traceBar"> ... </nav> block so we only count
  // Score indicators that sit on the breadcrumb line.
  const navMatch = html.match(/<nav class="traceBar"[\s\S]*?<\/nav>/);
  assert(navMatch, 'Expected <nav class="traceBar"> block in index.html');
  const traceBar = navMatch![0];

  // Exactly one canonical score badge by id.
  const traceScoreCount = (traceBar.match(/id="traceScore"/g) ?? []).length;
  assertEquals(
    traceScoreCount,
    1,
    "Expected exactly one #traceScore element inside the trace bar",
  );

  // Exactly one score badge by class. Counting the class (not just the
  // canonical id) catches a future duplicate introduced under a different
  // id — the failure mode the retired source-grep test could not detect.
  const scoreBadgeCount = (traceBar.match(/class="traceScore"/g) ?? []).length;
  assertEquals(
    scoreBadgeCount,
    1,
    "Expected exactly one .traceScore badge inside the trace bar",
  );

  // No duplicate path-score badge.
  assert(
    !/id="tracePathScore"/.test(traceBar),
    "Expected no #tracePathScore element inside the trace bar (Issue #247)",
  );
  assert(
    !/id="tracePathScoreValue"/.test(traceBar),
    "Expected no #tracePathScoreValue element inside the trace bar (Issue #247)",
  );
});
