function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  // .../tests/starfield_hud_synapse_counts_test.ts -> repo root
  const root = here.replace(
    /\/tests\/starfield_hud_synapse_counts_test\.ts$/,
    "",
  );
  return [root, ...parts].join("/");
}

Deno.test("graph HUD shows in/out synapse counts (Issue #44, 31-Dec-2025)", async () => {
  const jsPath = repoPath("docs", "graph", "graph.js");
  const js = await Deno.readTextFile(jsPath);

  assert(
    js.includes("Synapses: in=") && js.includes("out="),
    "Expected graph.js HUD to include synapse in/out counts for the focus neuron",
  );
  // Note: Glyph style display was removed in Issue #70/#77 since it's no longer
  // user-configurable and was causing a runtime error.
});
