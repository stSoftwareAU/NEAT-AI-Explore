function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  // .../tests/starfield_loader_panel_test.ts -> repo root
  const root = here.replace(/\/tests\/starfield_loader_panel_test\.ts$/, "");
  return [root, ...parts].join("/");
}

Deno.test("graph explorer collapses loader controls after snapshot loads (Issue #37, 31-Dec-2025)", async () => {
  const htmlPath = repoPath("docs", "graph", "index.html");
  const html = await Deno.readTextFile(htmlPath);

  assert(
    html.includes('id="snapshotDetails"'),
    `Expected ${htmlPath} to include a <details id="snapshotDetails"> wrapper`,
  );
  assert(
    html.includes("Snapshot"),
    `Expected ${htmlPath} to include a Snapshot summary label`,
  );

  const jsPath = repoPath("docs", "graph", "graph.js");
  const js = await Deno.readTextFile(jsPath);

  assert(
    js.includes('getElementById("snapshotDetails")'),
    `Expected ${jsPath} to reference the snapshotDetails element`,
  );
  assert(
    js.includes("details.open = false"),
    `Expected ${jsPath} to auto-collapse snapshotDetails after a successful load`,
  );
  assert(
    js.includes("details.open = true"),
    `Expected ${jsPath} to expand snapshotDetails on load errors`,
  );
});
