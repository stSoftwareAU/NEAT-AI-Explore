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

Deno.test("PWA hard-locks dark mode (theme toggle removed) (31-Dec-2025)", async () => {
  const indexPath = repoPath("docs", "index.html");
  const html = await Deno.readTextFile(indexPath);
  assert(
    !html.includes('id="themeToggle"'),
    `Expected ${indexPath} to omit the theme selector (dark mode only)`,
  );
  assert(
    /<meta\s+name="theme-color"\s+content="#f5f7fb"\s*\/?>/i.test(html),
    `Expected ${indexPath} to default theme-color to the light background (#f5f7fb) for first paint`,
  );
  assert(
    /<meta\s+name="theme-color"\s+content="#0a0e1a"\s+media="\(\s*prefers-color-scheme:\s*dark\s*\)"\s*\/?>/i
      .test(html),
    `Expected ${indexPath} to include a prefers-color-scheme: dark theme-colour override (#0a0e1a)`,
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
    js.includes('setAttribute("data-theme", "dark")'),
    `Expected ${appPath} to hard-lock data-theme="dark"`,
  );
});
