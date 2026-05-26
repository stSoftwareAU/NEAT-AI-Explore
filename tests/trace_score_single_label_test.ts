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
 * These tests pin the canonical badge (`#traceScore`) and assert the
 * duplicate plumbing is gone. They fail against the unfixed code where
 * `tracePathScore` / `updateTracePathScoreUI` still exist in `app.js`.
 */

import { assert, assertEquals } from "./test_helpers.ts";

const HTML_PATH = new URL("../docs/index.html", import.meta.url);
const APP_JS_PATH = new URL("../docs/app.js", import.meta.url);

async function loadHtml(): Promise<string> {
  return await Deno.readTextFile(HTML_PATH);
}

async function loadAppJs(): Promise<string> {
  return await Deno.readTextFile(APP_JS_PATH);
}

Deno.test("index.html exposes exactly one Score badge inside the trace bar (Issue #247)", async () => {
  const html = await loadHtml();

  // Extract the <nav class="traceBar"> ... </nav> block so we only count
  // Score indicators that sit on the breadcrumb line.
  const navMatch = html.match(/<nav class="traceBar"[\s\S]*?<\/nav>/);
  assert(navMatch, 'Expected <nav class="traceBar"> block in index.html');
  const traceBar = navMatch![0];

  // Exactly one canonical score badge.
  const traceScoreCount = (traceBar.match(/id="traceScore"/g) ?? []).length;
  assertEquals(
    traceScoreCount,
    1,
    "Expected exactly one #traceScore element inside the trace bar",
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

Deno.test("docs/app.js no longer wires the retired tracePathScore badge (Issue #247)", async () => {
  const src = await loadAppJs();

  // No element lookups for the retired indicator.
  assert(
    !/getElementById\(["']tracePathScore["']\)/.test(src),
    'Expected no document.getElementById("tracePathScore") lookup',
  );
  assert(
    !/getElementById\(["']tracePathScoreValue["']\)/.test(src),
    'Expected no document.getElementById("tracePathScoreValue") lookup',
  );

  // No dead update function definition or call sites.
  assert(
    !/\bupdateTracePathScoreUI\b/.test(src),
    "Expected no references to updateTracePathScoreUI in docs/app.js",
  );

  // The canonical badge must still be wired.
  assert(
    /getElementById\(["']traceScore["']\)/.test(src),
    "Expected docs/app.js to keep the #traceScore lookup",
  );
  assert(
    /renderTraceScore\s*\(/.test(src),
    "Expected docs/app.js to keep the renderTraceScore() call",
  );
});
