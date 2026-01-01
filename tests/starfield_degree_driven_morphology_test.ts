function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  // .../tests/starfield_degree_driven_morphology_test.ts -> repo root
  const root = here.replace(
    /\/tests\/starfield_degree_driven_morphology_test\.ts$/,
    "",
  );
  return [root, ...parts].join("/");
}

Deno.test("neuron glyph morphology varies with in/out degree (Issue #44, 31-Dec-2025)", async () => {
  const jsPath = repoPath("docs", "graph", "graph.js");
  const js = await Deno.readTextFile(jsPath);

  // The neuron glyph is now a "cell icon" (soma + nucleus + organelles). We no
  // longer draw dendrite/axon silhouettes inside the sprite (synapses are drawn
  // separately as ribbons).
  //
  // Degree still influences the glyph via subtle membrane ruffling/size tweaks.
  assert(
    js.includes("float ruffle = 0.03 + 0.02 * inDeg01"),
    "Expected neuron glyph shader to modulate membrane ruffling by inDeg01",
  );
  assert(
    js.includes("r += 0.02 * outDeg01"),
    "Expected neuron glyph shader to incorporate outDeg01 into the cell body",
  );
});
