function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  // .../tests/starfield_neuron_glyph_style_test.ts -> repo root
  const root = here.replace(
    /\/tests\/starfield_neuron_glyph_style_test\.ts$/,
    "",
  );
  return [root, ...parts].join("/");
}

Deno.test("starfield supports a neuron-style glyph mode + gallery (Issue #44, 31-Dec-2025)", async () => {
  const jsPath = repoPath("docs", "graph", "graph.js");
  const htmlPath = repoPath("docs", "graph", "index.html");
  const js = await Deno.readTextFile(jsPath);
  const html = await Deno.readTextFile(htmlPath);

  // Shader-driven glyph style toggle (abstract ↔ neuron-ish).
  assert(
    js.includes("uGlyphStyle"),
    "Expected graph.js shader to expose a uGlyphStyle uniform so glyph style can be toggled",
  );

  // Neuron-ish silhouette needs degree inputs so glyphs can encode dendrites/axon hints.
  assert(
    js.includes("aInDeg") && js.includes("aOutDeg"),
    "Expected graph.js shader attributes aInDeg/aOutDeg so glyphs can encode in/out degree",
  );

  // UI wiring: a button for switching glyph style + a gallery container.
  assert(
    html.includes('id="glyphToggle"'),
    'Expected graph/index.html to include a glyph style toggle button with id="glyphToggle"',
  );
  assert(
    html.includes('id="glyphGallery"'),
    'Expected graph/index.html to include a glyph gallery container with id="glyphGallery"',
  );
});
