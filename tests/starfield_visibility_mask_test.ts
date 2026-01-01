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

Deno.test("visibility mask uses the output->focus path for the *new* focus (Issue #44, 1-Jan-2026)", async () => {
  const jsPath = repoPath("docs", "graph", "graph.js");
  const js = await Deno.readTextFile(jsPath);

  const anchor = "renderer.onFocusChanged";
  const start = js.indexOf(anchor);
  assert(start !== -1, "Expected graph.js to define renderer.onFocusChanged");

  // Keep the scan local to the focus-change handler so we don't accidentally
  // match earlier/later occurrences in the file.
  const chunk = js.slice(start, start + 12000);

  const recomputeIdx = chunk.indexOf("outputPathToFocus =");
  const computeIdx = chunk.indexOf("computeOutputPathToFocus");
  const readIdx = chunk.indexOf("const pathTail = outputPathToFocus");
  assert(
    recomputeIdx !== -1,
    "Expected outputPathToFocus to be recomputed on focus changes",
  );
  assert(
    computeIdx !== -1,
    "Expected focus handler to call computeOutputPathToFocus()",
  );
  assert(
    readIdx !== -1,
    "Expected focus handler to read outputPathToFocus for visibility mask",
  );

  assert(
    recomputeIdx < readIdx,
    "Expected outputPathToFocus to be recomputed before the visibility mask reads it (avoids stale path from previous focus)",
  );
});
