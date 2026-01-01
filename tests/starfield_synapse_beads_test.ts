function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  // .../tests/starfield_synapse_beads_test.ts -> repo root
  const root = here.replace(/\/tests\/starfield_synapse_beads_test\.ts$/, "");
  return [root, ...parts].join("/");
}

Deno.test("graph renders synapses as thick ribbons (Issue #44, 1-Jan-2026)", async () => {
  const jsPath = repoPath("docs", "graph", "graph.js");
  const js = await Deno.readTextFile(jsPath);

  assert(
    js.includes("updateSynapses") && js.includes("appendSynapseRibbon"),
    "Expected graph.js to build synapse ribbons and upload them to the renderer",
  );
  assert(
    js.includes("Synapse ribbon program"),
    "Expected graph.js to define a dedicated synapse ribbon program",
  );
});
