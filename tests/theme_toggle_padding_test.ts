function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  // .../tests/theme_toggle_padding_test.ts -> repo root
  const root = here.replace(/\/tests\/theme_toggle_padding_test\.ts$/, "");
  return [root, ...parts].join("/");
}

Deno.test("Theme toggle padding overrides .button padding", async () => {
  const cssPath = repoPath("docs", "styles.css");
  const css = await Deno.readTextFile(cssPath);

  // Regression guard:
  // The theme toggle button has both classes: "button" and "themeToggle".
  // If .themeToggle is declared before .button (or equal specificity), then
  // .button's padding wins, shrinking the content area. We require a more
  // specific selector to force the intended padding.
  assert(
    /\.button\.themeToggle\s*\{[\s\S]*?\bpadding:\s*6px\s+0\s*;[\s\S]*?\}/m
      .test(
        css,
      ),
    `Expected ${cssPath} to define ".button.themeToggle { padding: 6px 0; }" (or equivalent)`,
  );
});
