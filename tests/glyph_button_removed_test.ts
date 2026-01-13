function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  // .../tests/glyph_button_removed_test.ts -> repo root
  const root = here.replace(/\/tests\/glyph_button_removed_test\.ts$/, "");
  return [root, ...parts].join("/");
}

Deno.test("glyph toggle button is removed from graph explorer (Issue #70, 14-Jan-2026)", async () => {
  const htmlPath = repoPath("docs", "graph", "index.html");
  const html = await Deno.readTextFile(htmlPath);

  // The glyph toggle button should be removed to declutter the UI.
  assert(
    !html.includes('id="glyphToggle"'),
    'Expected graph/index.html to NOT include a glyph toggle button with id="glyphToggle" (removed in Issue #70)',
  );
});

Deno.test("glyph style toggle event listener is removed (Issue #70, 14-Jan-2026)", async () => {
  const jsPath = repoPath("docs", "graph", "graph.js");
  const js = await Deno.readTextFile(jsPath);

  // The glyph toggle event listener should be removed.
  assert(
    !js.includes("el.glyphToggle.addEventListener"),
    "Expected graph.js to NOT include a glyph toggle event listener (removed in Issue #70)",
  );
});

Deno.test("glyph gallery is removed from graph explorer (Issue #70, 14-Jan-2026)", async () => {
  const htmlPath = repoPath("docs", "graph", "index.html");
  const html = await Deno.readTextFile(htmlPath);

  // The glyph gallery container should be removed.
  assert(
    !html.includes('id="glyphGallery"'),
    'Expected graph/index.html to NOT include a glyph gallery container with id="glyphGallery" (removed in Issue #70)',
  );
});

Deno.test("applyGlyphStyleUi function is removed (Issue #70, 14-Jan-2026)", async () => {
  const jsPath = repoPath("docs", "graph", "graph.js");
  const js = await Deno.readTextFile(jsPath);

  // The applyGlyphStyleUi function should be removed as it's dead code now.
  assert(
    !js.includes("applyGlyphStyleUi"),
    "Expected graph.js to NOT include applyGlyphStyleUi function (removed in Issue #70)",
  );
});

Deno.test("glyphStyle global variable is removed (Issue #70, 14-Jan-2026)", async () => {
  const jsPath = repoPath("docs", "graph", "graph.js");
  const js = await Deno.readTextFile(jsPath);

  // The glyphStyle variable should be removed.
  assert(
    !js.includes('let glyphStyle = "neuron"'),
    "Expected graph.js to NOT include glyphStyle variable (removed in Issue #70)",
  );
});

Deno.test("renderGlyphGallery function is removed (Issue #70, 14-Jan-2026)", async () => {
  const jsPath = repoPath("docs", "graph", "graph.js");
  const js = await Deno.readTextFile(jsPath);

  // The renderGlyphGallery function should be removed.
  assert(
    !js.includes("function renderGlyphGallery"),
    "Expected graph.js to NOT include renderGlyphGallery function (removed in Issue #70)",
  );
});

Deno.test("glyphs still render correctly in neuron style by default (Issue #70, 14-Jan-2026)", async () => {
  const jsPath = repoPath("docs", "graph", "graph.js");
  const js = await Deno.readTextFile(jsPath);

  // The glyphKindForNeuron function should still exist as it determines glyph shapes.
  assert(
    js.includes("function glyphKindForNeuron"),
    "Expected graph.js to still include glyphKindForNeuron function for glyph shape determination",
  );

  // The shader should still support rendering glyphs (aGlyph/vGlyph attributes).
  assert(
    js.includes("aGlyph") && js.includes("vGlyph"),
    "Expected graph.js to still include aGlyph/vGlyph shader attributes",
  );
});
