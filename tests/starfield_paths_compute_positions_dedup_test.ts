function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  // .../tests/starfield_paths_compute_positions_dedup_test.ts -> repo root
  const root = here.replace(
    /\/tests\/starfield_paths_compute_positions_dedup_test\.ts$/,
    "",
  );
  return [root, ...parts].join("/");
}

function countOccurrences(haystack: string, needle: string): number {
  let n = 0;
  let i = 0;
  while (true) {
    const j = haystack.indexOf(needle, i);
    if (j < 0) return n;
    n++;
    i = j + needle.length;
  }
}

Deno.test("starfield paths mode computes upstream positions once per focus change (Issue #25)", async () => {
  const jsPath = repoPath("docs", "graph", "graph.js");
  const js = await Deno.readTextFile(jsPath);

  const start = js.indexOf("renderer.onFocusChanged = (idx, m");
  assert(start >= 0, "Expected renderer.onFocusChanged handler to exist.");

  // Use a stable marker immediately after the handler to bound the search.
  const endMarker = "buildHudForIndex(-1);";
  const end = js.indexOf(endMarker, start);
  assert(end > start, "Expected to find end marker after onFocusChanged.");

  const handler = js.slice(start, end);

  const calls = countOccurrences(handler, "computePositionsForUpstream({");
  assert(
    calls === 1,
    `Expected onFocusChanged to call computePositionsForUpstream({ exactly once; found ${calls}.`,
  );
});
