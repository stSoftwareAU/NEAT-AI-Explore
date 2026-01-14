function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  // .../tests/brain_emoji_button_test.ts -> repo root
  const root = here.replace(/\/tests\/brain_emoji_button_test\.ts$/, "");
  return [root, ...parts].join("/");
}

Deno.test("trace view uses brain emoji for 3D graph button (Issue #73)", async () => {
  const htmlPath = repoPath("docs", "index.html");
  const html = await Deno.readTextFile(htmlPath);

  assert(
    html.includes('id="graphBtn"'),
    "Expected docs/index.html to have a graph button with id graphBtn",
  );

  // Issue #73: button should use brain emoji 🧠 instead of star emoji
  assert(
    html.includes("🧠"),
    "Expected graphBtn to use a brain emoji (🧠) instead of star emoji (Issue #73)",
  );

  // Ensure the old star emoji is no longer used in the button
  const graphBtnMatch = html.match(/<a[^>]*id="graphBtn"[^>]*>([^<]*)<\/a>/);
  assert(
    graphBtnMatch && !graphBtnMatch[1].includes("🌟") &&
      !graphBtnMatch[1].includes("⭐"),
    "Expected graphBtn to not contain star emoji (🌟 or ⭐) - should use brain emoji instead",
  );
});

Deno.test("graphBtn anchor has no underline styling (Issue #73)", async () => {
  const cssPath = repoPath("docs", "styles.css");
  const css = await Deno.readTextFile(cssPath);

  // The graphBtn (or anchor buttons in general) should have text-decoration: none
  // to remove the underline from anchor elements styled as buttons
  assert(
    css.includes("#graphBtn") ||
      css.includes("a.button") ||
      (css.includes(".button") && css.includes("text-decoration")),
    "Expected styles.css to include styling that removes underline from anchor buttons (Issue #73)",
  );

  // More specific check: ensure there's a rule that sets text-decoration: none
  // for the graphBtn or anchor buttons
  const hasNoUnderlineRule = css.includes("text-decoration: none") ||
    css.includes("text-decoration:none");
  assert(
    hasNoUnderlineRule,
    "Expected styles.css to have text-decoration: none for graphBtn anchor (Issue #73)",
  );
});
