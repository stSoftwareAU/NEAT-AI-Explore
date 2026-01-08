function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  const root = here.replace(
    /\/tests\/starfield_click_restriction_test\.ts$/,
    "",
  );
  return [root, ...parts].join("/");
}

Deno.test("starfield restricts clicks to connected neurons only (Issue #50)", async () => {
  const jsPath = repoPath("docs", "graph", "graph.js");
  const js = await Deno.readTextFile(jsPath);

  // The click handler should check if clicked neuron is connected to current focus.
  assert(
    js.includes("isConnectedToFocus") || js.includes("isNeighbourOfFocus"),
    `Expected ${jsPath} to include a helper that checks if a neuron is connected to the current focus`,
  );

  // The adjacency check should be used in the click handler.
  assert(
    js.includes('c.addEventListener("click"'),
    `Expected ${jsPath} to have a click event listener on canvas`,
  );

  // Look for click restriction logic near the click handler.
  const clickHandlerStart = js.indexOf('c.addEventListener("click"');
  assert(clickHandlerStart >= 0, `Expected ${jsPath} to include click handler`);

  const clickHandlerEnd = js.indexOf("});", clickHandlerStart);
  const clickHandler = js.slice(clickHandlerStart, clickHandlerEnd + 3);

  assert(
    clickHandler.includes("adjacency") ||
      clickHandler.includes("isConnectedToFocus") ||
      clickHandler.includes("isNeighbourOfFocus"),
    `Expected click handler to check adjacency before allowing focus change`,
  );
});

Deno.test("starfield exposes isConnectedToFocus in debug API (Issue #50)", async () => {
  const jsPath = repoPath("docs", "graph", "graph.js");
  const js = await Deno.readTextFile(jsPath);

  // The debug API should expose a way to check if a neuron is connected.
  assert(
    js.includes("__neatStarfield") && js.includes("exposeDebugApi"),
    `Expected ${jsPath} to expose debug API`,
  );

  // Check debug API includes connected check.
  const debugApiStart = js.indexOf("window.__neatStarfield = {");
  assert(debugApiStart >= 0, `Expected ${jsPath} to define __neatStarfield`);

  const debugApiEnd = js.indexOf("};", debugApiStart + 100);
  const debugApi = js.slice(debugApiStart, debugApiEnd + 2);

  assert(
    debugApi.includes("isConnectedToFocus") ||
      debugApi.includes("canFocusNeuron"),
    `Expected debug API to include a method to check if a neuron can be focused`,
  );
});
