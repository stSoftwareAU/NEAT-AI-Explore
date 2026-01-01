function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  // .../tests/starfield_entrypoint_test.ts -> repo root
  const root = here.replace(/\/tests\/starfield_entrypoint_test\.ts$/, "");
  return [root, ...parts].join("/");
}

Deno.test("starfield page imports an existing JS entrypoint (Issue #44, 1-Jan-2026)", async () => {
  const htmlPath = repoPath("docs", "starfield", "index.html");
  const jsPath = repoPath("docs", "starfield", "starfield.js");

  const html = await Deno.readTextFile(htmlPath);
  assert(
    html.includes("import(") && html.includes("starfield.js?v="),
    "Expected docs/starfield/index.html to import starfield.js with cache busting",
  );

  const js = await Deno.readTextFile(jsPath);
  assert(js.trim().length > 0, "Expected docs/starfield/starfield.js to exist");
  assert(
    js.includes('import "../graph/graph.js"') ||
      js.includes('import "../graph/graph.js";'),
    "Expected docs/starfield/starfield.js to delegate to docs/graph/graph.js",
  );

  // Regression guard:
  // The starfield entrypoint must remain a thin wrapper (import-only). If it
  // contains a full renderer implementation, the starfield page can drift and
  // miss new graph explorer features (visibility masks, synapse ribbons, zoom
  // controls, updated glyphs, etc.).
  const lineCount = js.split("\n").length;
  assert(
    lineCount < 80,
    `Expected docs/starfield/starfield.js to stay thin (<80 lines), got ${lineCount}`,
  );
  assert(
    !js.includes("class StarfieldRenderer") && !js.includes("initStarfield"),
    "Expected docs/starfield/starfield.js not to embed a renderer implementation",
  );
});
