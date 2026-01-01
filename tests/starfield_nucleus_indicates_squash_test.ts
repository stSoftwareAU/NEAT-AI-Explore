function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  // .../tests/starfield_nucleus_indicates_squash_test.ts -> repo root
  const root = here.replace(
    /\/tests\/starfield_nucleus_indicates_squash_test\.ts$/,
    "",
  );
  return [root, ...parts].join("/");
}

Deno.test("neuron glyph nucleus indicates squash family (Issue #44, 1-Jan-2026)", async () => {
  const jsPath = repoPath("docs", "graph", "graph.js");
  const js = await Deno.readTextFile(jsPath);

  // Nucleus should be derived from vGlyph (squash family), not vBias.
  assert(
    js.includes("nucleusUv") && js.includes("glyphFill(nucleusUv, vGlyph)"),
    "Expected nucleus to be rendered from vGlyph (squash family)",
  );
  assert(
    !js.includes("nucleusOffset") && !js.includes("biasMag"),
    "Expected nucleus not to be positioned by bias (vBias)",
  );
});
