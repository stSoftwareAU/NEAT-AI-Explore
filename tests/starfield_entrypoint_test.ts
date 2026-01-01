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
});
