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
 * move it between header and trace bar. This test reads the published
 * `docs/index.html` and asserts the structural invariants of that fix.
 */

import { assert, assertEquals } from "./test_helpers.ts";

const HTML_PATH = new URL("../docs/index.html", import.meta.url);

async function loadHtml(): Promise<string> {
  return await Deno.readTextFile(HTML_PATH);
}

Deno.test("docs/index.html declares exactly one theme toggle button (Issue #204)", async () => {
  const html = await loadHtml();
  const matches = html.match(/class="[^"]*\bthemeToggle\b[^"]*"/g) ?? [];
  assertEquals(
    matches.length,
    1,
    `Expected exactly one .themeToggle button, found ${matches.length}: ${
      matches.join(" | ")
    }`,
  );
});

Deno.test("docs/index.html no longer ships #themeToggleTrace (Issue #204)", async () => {
  const html = await loadHtml();
  assert(
    !html.includes('id="themeToggleTrace"'),
    "Found stale #themeToggleTrace element — should have been removed when " +
      "consolidating onto the single JS-managed #themeToggle.",
  );
});

Deno.test("docs/index.html keeps the single #themeToggle button (Issue #204)", async () => {
  const html = await loadHtml();
  assert(
    html.includes('id="themeToggle"'),
    "The single #themeToggle button must remain — JS moves it between header " +
      "and trace bar based on viewport size.",
  );
});
