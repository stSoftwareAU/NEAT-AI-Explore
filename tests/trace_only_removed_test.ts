/**
 * Tests that verify the broken "trace only" checkbox has been removed.
 *
 * Issue #61: The "trace only" filter was non-functional because it filtered
 * inbound synapses to only show those whose source neurons were already in
 * the trace. However, when navigating upstream (from outputs toward inputs),
 * the inbound synapses always come from neurons NOT yet visited - making the
 * filter useless (it would filter out everything or nearly everything).
 *
 * This test ensures:
 * 1. The HTML no longer contains the synapseTraceOnly checkbox element
 * 2. The CSS no longer contains trace-only-related styling (if any)
 * 3. The JS no longer contains inboundTraceOnly state management
 */

function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const here = new URL(".", import.meta.url).pathname;
  // tests/* -> repo root
  const root = here.replace(/\/tests\/?$/, "");
  return [root, ...parts].join("/");
}

Deno.test("synapseTraceOnly checkbox is removed from index.html", async () => {
  const indexHtmlPath = repoPath("docs", "index.html");
  const html = await Deno.readTextFile(indexHtmlPath);

  // The checkbox should no longer exist
  assert(
    !html.includes('id="synapseTraceOnly"'),
    'index.html should not contain id="synapseTraceOnly" - the broken feature should be removed',
  );

  // The label text should also be removed
  assert(
    !html.includes("Trace only"),
    'index.html should not contain "Trace only" label text - the broken feature should be removed',
  );
});

Deno.test("inboundTraceOnly state variable is removed from app.js", async () => {
  const appJsPath = repoPath("docs", "app.js");
  const js = await Deno.readTextFile(appJsPath);

  // The state variable should no longer exist
  assert(
    !js.includes("inboundTraceOnly"),
    'app.js should not contain "inboundTraceOnly" - the broken feature should be removed',
  );

  // The element reference should also be removed
  assert(
    !js.includes("synapseTraceOnly"),
    'app.js should not contain "synapseTraceOnly" - the broken feature should be removed',
  );
});
