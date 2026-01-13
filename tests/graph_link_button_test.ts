function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  // .../tests/graph_link_button_test.ts -> repo root
  const root = here.replace(/\/tests\/graph_link_button_test\.ts$/, "");
  return [root, ...parts].join("/");
}

Deno.test("trace view exposes a 3D graph link (Issue #44, 31-Dec-2025)", async () => {
  const htmlPath = repoPath("docs", "index.html");
  const html = await Deno.readTextFile(htmlPath);
  assert(
    html.includes('id="graphBtn"'),
    "Expected docs/index.html to expose a 3D graph button (graphBtn)",
  );
  // Issue #73: button now uses brain emoji instead of star emoji to save space
  assert(
    html.includes("🧠"),
    "Expected graphBtn to use a brain emoji (Issue #73)",
  );
});
