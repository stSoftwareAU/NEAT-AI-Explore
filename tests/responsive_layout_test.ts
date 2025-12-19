function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  // .../tests/responsive_layout_test.ts -> repo root
  const root = here.replace(/\/tests\/responsive_layout_test\.ts$/, "");
  return [root, ...parts].join("/");
}

Deno.test("styles include mobile breakpoints for iPhone/iPad", async () => {
  const p = repoPath("docs", "styles.css");
  const css = await Deno.readTextFile(p);

  // The core fix: switch the main explorer from 2 columns to stacked panels on
  // small screens (prevents horizontal overflow in PWA standalone on iPhone).
  assert(
    css.includes("@media (max-width: 900px)"),
    `Expected ${p} to include a max-width: 900px breakpoint`,
  );
  assert(
    css.includes(".explorerMain") && css.includes("flex-direction: column"),
    `Expected ${p} to switch .explorerMain to column layout at small widths`,
  );
  assert(
    css.includes(".headerControls") && css.includes("flex-wrap: wrap"),
    `Expected ${p} to allow header controls to wrap on small screens`,
  );
});
