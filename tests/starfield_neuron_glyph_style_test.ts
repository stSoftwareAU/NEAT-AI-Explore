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

Deno.test("starfield renders neuron-style glyphs by default (Issue #44, updated Issue #70, 14-Jan-2026)", async () => {
  const jsPath = repoPath("docs", "graph", "graph.js");
  const js = await Deno.readTextFile(jsPath);

  // Shader still supports glyph rendering via the uGlyphStyle uniform.
  // The uniform is now hardcoded to neuron-style (1.0) since the toggle was
  // removed in Issue #70.
  assert(
    js.includes("uGlyphStyle"),
    "Expected graph.js shader to expose a uGlyphStyle uniform for glyph rendering",
  );

  // Neuron-ish silhouette needs degree inputs so glyphs can encode dendrites/axon hints.
  assert(
    js.includes("aInDeg") && js.includes("aOutDeg"),
    "Expected graph.js shader attributes aInDeg/aOutDeg so glyphs can encode in/out degree",
  );

  // Glyph style is now hardcoded to neuron-style (1.0), set directly on the renderer.
  assert(
    js.includes("renderer.glyphStyle01 = 1"),
    "Expected graph.js to set glyphStyle01 to 1 (neuron-style) by default",
  );
});
