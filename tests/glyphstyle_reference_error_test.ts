/**
 * Test for Issue #77: Fix "Can't find variable: glyphStyle" error.
 *
 * Issue #70 removed the glyphStyle variable and glyph toggle button, but there
 * was a remaining reference to glyphStyle in the HUD display code (line 3149).
 * This caused a runtime error "Can't find variable: glyphStyle" on the graph page.
 *
 * This test verifies:
 * 1. The glyphStyle variable is not referenced where it's undefined
 * 2. The HUD no longer displays glyph style since it's no longer configurable
 */

function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  const root = here.replace(
    /\/tests\/glyphstyle_reference_error_test\.ts$/,
    "",
  );
  return [root, ...parts].join("/");
}

Deno.test("graph.js does not reference undefined glyphStyle variable (Issue #77)", async () => {
  const p = repoPath("docs", "graph", "graph.js");
  const js = await Deno.readTextFile(p);

  // The line `Glyph: ${glyphStyle}` should be removed since glyphStyle variable
  // was removed in Issue #70. This reference caused a runtime error.
  // Note: glyphStyle01 is a valid renderer property, so we only check for the
  // bare `glyphStyle` usage in template literals.
  assert(
    !js.includes("`Glyph: ${glyphStyle}`"),
    `Expected graph.js to NOT reference undefined glyphStyle variable in HUD display`,
  );
});

Deno.test("graph.js HUD does not display glyph style since it's no longer configurable (Issue #77)", async () => {
  const p = repoPath("docs", "graph", "graph.js");
  const js = await Deno.readTextFile(p);

  // Since the glyph style is now fixed at "neuron" and not user-configurable,
  // we shouldn't display it in the HUD at all (it's noise, not signal).
  // The "Glyph:" line should be removed entirely from buildHudText.
  //
  // Note: The presence of "Glyph:" elsewhere in the file (e.g., in comments or
  // other contexts) is fine. We specifically check that it's not in the
  // buildHudText function's lines array push.
  assert(
    !js.includes("lines.push(`Glyph:"),
    `Expected graph.js HUD to NOT display glyph style since it's no longer configurable`,
  );
});

Deno.test("glyphStyle01 renderer property still exists for WebGL shader (Issue #77)", async () => {
  const p = repoPath("docs", "graph", "graph.js");
  const js = await Deno.readTextFile(p);

  // glyphStyle01 is a valid renderer property used for WebGL shading.
  // This should NOT be removed - only the user-facing variable was removed.
  assert(
    js.includes("glyphStyle01"),
    `Expected graph.js to still have glyphStyle01 renderer property for WebGL`,
  );
});
