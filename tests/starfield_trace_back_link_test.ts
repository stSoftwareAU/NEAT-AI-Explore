function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  // .../tests/starfield_trace_back_link_test.ts -> repo root
  const root = here.replace(/\/tests\/starfield_trace_back_link_test\.ts$/, "");
  return [root, ...parts].join("/");
}

Deno.test("starfield/graph view has a link back to trace view (Issue #65)", async () => {
  const htmlPath = repoPath("docs", "graph", "index.html");
  const html = await Deno.readTextFile(htmlPath);

  // There should be a link or button to navigate back to the trace view
  assert(
    html.includes('id="traceBtn"') || html.includes('href="../"') ||
      html.includes("href='../'") || html.includes("Trace"),
    "Expected graph/index.html to have a way to navigate back to trace view (Issue #65)",
  );

  // The UI should indicate it's a navigation back to trace explorer
  assert(
    html.includes("Trace") || html.includes("trace"),
    "Expected graph view to have a Trace link/button for navigation back",
  );
});
