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

  // We expect the shader to *hide* the axon when out-degree is near zero.
  assert(
    js.includes("if (outDeg01 > 0.05)"),
    "Expected neuron glyph shader to gate axon rendering on outDeg01",
  );

  // We expect additional dendrite branches to be added as inDeg01 increases.
  const thresholds = [
    "if (inDeg01 > 0.18)",
    "if (inDeg01 > 0.33)",
    "if (inDeg01 > 0.50)",
  ];
  for (const t of thresholds) {
    assert(
      js.includes(t),
      `Expected neuron glyph shader to include dendrite branch threshold ${t}`,
    );
  }
});
