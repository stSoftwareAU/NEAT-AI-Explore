function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  // .../tests/synapse_ribbon_safe_normalise_test.ts -> repo root
  const root = here.replace(
    /\/tests\/synapse_ribbon_safe_normalise_test\.ts$/,
    "",
  );
  return [root, ...parts].join("/");
}

Deno.test("synapse ribbon shader avoids NaNs when segment aligns with camera (Issue #44, 1-Jan-2026)", async () => {
  const jsPath = repoPath("docs", "graph", "graph.js");
  const js = await Deno.readTextFile(jsPath);

  const anchor = "Synapse ribbon program";
  const start = js.indexOf(anchor);
  assert(
    start !== -1,
    "Expected graph.js to define the synapse ribbon program",
  );

  // Keep the scan local so we don't accidentally match unrelated shader strings.
  const chunk = js.slice(start, start + 5000);

  // `normalize(vec2(0))` yields NaNs in GLSL, which can corrupt the clip-space
  // offset expansion and cause flicker/missing ribbon segments when a synapse
  // points toward/away from the camera.
  assert(
    !chunk.includes("normalize(viewDir3.xy)"),
    "Expected synapse ribbon vertex shader to avoid normalize(viewDir3.xy) (needs epsilon guard)",
  );
  assert(
    chunk.includes("inversesqrt") && chunk.includes("max(") &&
      chunk.includes("dot("),
    "Expected synapse ribbon vertex shader to use an epsilon-clamped normalisation (inversesqrt/max/dot)",
  );
});
