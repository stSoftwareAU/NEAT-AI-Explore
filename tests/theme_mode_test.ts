function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  // .../tests/theme_mode_test.ts -> repo root
  const root = here.replace(/\/tests\/theme_mode_test\.ts$/, "");
  return [root, ...parts].join("/");
}

Deno.test("PWA supports light/dark/auto theme mode", async () => {
  const indexPath = repoPath("docs", "index.html");
  const html = await Deno.readTextFile(indexPath);
  assert(
    html.includes('id="themeToggle"'),
    `Expected ${indexPath} to include a #themeToggle control`,
  );
  assert(
    /id="themeToggle"[\s\S]*?>\s*A\s*</.test(html),
    `Expected ${indexPath} to default the theme toggle to "A" (auto)`,
  );

  const cssPath = repoPath("docs", "styles.css");
  const css = await Deno.readTextFile(cssPath);
  assert(
    css.includes("prefers-color-scheme"),
    `Expected ${cssPath} to include prefers-color-scheme for auto mode`,
  );
  assert(
    css.includes('data-theme="dark"') && css.includes('data-theme="light"'),
    `Expected ${cssPath} to include [data-theme] overrides`,
  );

  const appPath = repoPath("docs", "app.js");
  const js = await Deno.readTextFile(appPath);
  assert(
    js.includes("localStorage") && js.includes("themeMode"),
    `Expected ${appPath} to persist themeMode in localStorage`,
  );
  assert(
    js.includes("data-theme") || js.includes("dataset.theme"),
    `Expected ${appPath} to apply theme via a data-theme attribute`,
  );
  assert(
    js.includes("themeToggle"),
    `Expected ${appPath} to wire up a theme toggle control`,
  );
});
