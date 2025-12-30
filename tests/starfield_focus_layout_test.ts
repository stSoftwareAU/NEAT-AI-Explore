function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  // .../tests/starfield_focus_layout_test.ts -> repo root
  const root = here.replace(/\/tests\/starfield_focus_layout_test\.ts$/, "");
  return [root, ...parts].join("/");
}

Deno.test("starfield uses focus-centric layout (Issue #25)", async () => {
  const jsPath = repoPath("docs", "starfield", "starfield.js");
  const htmlPath = repoPath("docs", "starfield", "index.html");

  const js = await Deno.readTextFile(jsPath);
  const html = await Deno.readTextFile(htmlPath);

  // We want a focus-driven neighbourhood view, not a static global projection.
  assert(
    js.includes("computeGraphDistancesFromFocus") ||
      js.includes("computePositionsForFocus"),
    `Expected ${jsPath} to include a focus-centric BFS/positioning helper`,
  );
  assert(
    js.includes("buildAdjacency") && js.includes("Undirected adjacency"),
    `Expected ${jsPath} to build an undirected adjacency list for 'directly linked' nodes`,
  );
  assert(
    js.includes("renderer.resetCamera") || js.includes("resetCamera()"),
    `Expected ${jsPath} to re-centre the camera on focus changes`,
  );
  assert(
    html.includes("distance from focus") || html.includes("directly linked"),
    `Expected ${htmlPath} legend to describe focus-centric positioning`,
  );
});
