function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  // .../tests/starfield_glyphs_v1_test.ts -> repo root
  const root = here.replace(/\/tests\/starfield_glyphs_v1_test\.ts$/, "");
  return [root, ...parts].join("/");
}

Deno.test("starfield exposes v1 neuron glyph attributes + squash→glyph mapping (Issue #43, 31-Dec-2025)", async () => {
  const jsPath = repoPath("docs", "graph", "graph.js");
  const js = await Deno.readTextFile(jsPath);

  // Neuron glyphs should be rendered as point-sprite silhouettes, not just circles.
  assert(
    js.includes("aGlyph") && js.includes("vGlyph"),
    "Expected graph.js to include aGlyph/vGlyph shader attributes for glyph silhouettes",
  );
  assert(
    js.includes("aBias") || js.includes("vBias"),
    "Expected graph.js to include a bias attribute/varying so bias can be encoded spatially (nucleus offset)",
  );

  // The mapping must cover the real snapshot’s common squashes so the view is
  // immediately useful (SQUARE/SELU/BENT_IDENTITY/ABSOLUTE/STEP/LOGISTIC).
  const required = [
    "SQUARE",
    "SELU",
    "BENT_IDENTITY",
    "ABSOLUTE",
    "STEP",
    "LOGISTIC",
  ];
  for (const name of required) {
    assert(
      js.includes(name),
      `Expected graph.js glyph mapping to mention squash ${name}`,
    );
  }
});
