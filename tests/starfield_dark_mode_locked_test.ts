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

Deno.test("starfield hard-locks dark mode for visibility (30-Dec-2025)", async () => {
  const htmlPath = repoPath("docs", "starfield", "index.html");
  const html = await Deno.readTextFile(htmlPath);

  assert(
    html.includes('id="themeToggle"'),
    `Expected ${htmlPath} to include the theme toggle button`,
  );
  assert(
    /id="themeToggle"[\s\S]*disabled/.test(html),
    `Expected ${htmlPath} to disable the theme toggle (locked dark mode)`,
  );
  assert(
    /id="themeToggle"[\s\S]*?>\s*☾\s*</.test(html),
    `Expected ${htmlPath} theme toggle glyph to be ☾ (dark)`,
  );

  const jsPath = repoPath("docs", "starfield", "starfield.js");
  const js = await Deno.readTextFile(jsPath);
  assert(
    js.includes('setAttribute("data-theme", "dark")'),
    `Expected ${jsPath} to force data-theme="dark"`,
  );
});
