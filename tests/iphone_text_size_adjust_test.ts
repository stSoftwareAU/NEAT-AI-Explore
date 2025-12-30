function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  // .../tests/iphone_text_size_adjust_test.ts -> repo root
  const root = here.replace(/\/tests\/iphone_text_size_adjust_test\.ts$/, "");
  return [root, ...parts].join("/");
}

Deno.test("styles disable iOS Safari text inflation to preserve iPhone layout (30-Dec-2025)", async () => {
  const cssPath = repoPath("docs", "styles.css");
  const css = await Deno.readTextFile(cssPath);

  assert(
    css.includes("-webkit-text-size-adjust: 100%"),
    `Expected ${cssPath} to set -webkit-text-size-adjust: 100%`,
  );
  assert(
    css.includes("text-size-adjust: 100%"),
    `Expected ${cssPath} to set text-size-adjust: 100%`,
  );
});
