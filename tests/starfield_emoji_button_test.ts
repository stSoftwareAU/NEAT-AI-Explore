function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  // .../tests/starfield_emoji_button_test.ts -> repo root
  const root = here.replace(/\/tests\/starfield_emoji_button_test\.ts$/, "");
  return [root, ...parts].join("/");
}

Deno.test("trace view uses star emoji for 3D graph button (Issue #65)", async () => {
  const htmlPath = repoPath("docs", "index.html");
  const html = await Deno.readTextFile(htmlPath);

  assert(
    html.includes('id="graphBtn"'),
    "Expected docs/index.html to have a graph button with id graphBtn",
  );

  // The button should use a star emoji (🌟 or ⭐) instead of text "3D Graph"
  // to save space on mobile devices
  assert(
    html.includes("🌟") || html.includes("⭐"),
    "Expected graphBtn to use a star emoji (🌟 or ⭐) instead of text to save space (Issue #65)",
  );

  // Ensure the old "3D Graph" text is no longer used in the button
  // (The graphBtn should not contain the literal text "3D Graph")
  const graphBtnMatch = html.match(/<a[^>]*id="graphBtn"[^>]*>([^<]*)<\/a>/);
  assert(
    graphBtnMatch && !graphBtnMatch[1].includes("3D Graph"),
    "Expected graphBtn to not contain '3D Graph' text (should use emoji instead)",
  );
});
