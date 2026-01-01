function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  // .../tests/starfield_visibility_mask_test.ts -> repo root
  const root = here.replace(/\/tests\/starfield_visibility_mask_test\.ts$/, "");
  return [root, ...parts].join("/");
}

Deno.test("graph uses a per-neuron visibility mask to avoid starfield noise (Issue #44, 1-Jan-2026)", async () => {
  const jsPath = repoPath("docs", "graph", "graph.js");
  const js = await Deno.readTextFile(jsPath);

  assert(
    js.includes("aVis") && js.includes("updateVisibility"),
    "Expected graph.js to expose an aVis attribute and updateVisibility() for focus-based fading",
  );
});
