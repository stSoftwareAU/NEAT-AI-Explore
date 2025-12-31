function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  // .../tests/starfield_dark_mode_locked_test.ts -> repo root
  const root = here.replace(
    /\/tests\/starfield_dark_mode_locked_test\.ts$/,
    "",
  );
  return [root, ...parts].join("/");
}

Deno.test("starfield hard-locks dark mode for visibility (and hides theme selector) (31-Dec-2025)", async () => {
  const htmlPath = repoPath("docs", "graph", "index.html");
  const html = await Deno.readTextFile(htmlPath);

  assert(
    !html.includes('id="themeToggle"'),
    `Expected ${htmlPath} to omit the theme selector (Issue #38)`,
  );

  const jsPath = repoPath("docs", "graph", "graph.js");
  const js = await Deno.readTextFile(jsPath);
  assert(
    js.includes('setAttribute("data-theme", "dark")'),
    `Expected ${jsPath} to force data-theme="dark"`,
  );
});
