function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  // .../tests/mobile_tooltip_test.ts -> repo root
  const root = here.replace(/\/tests\/mobile_tooltip_test\.ts$/, "");
  return [root, ...parts].join("/");
}

Deno.test("tooltips work on mobile via press-and-hold", async () => {
  const appPath = repoPath("docs", "app.js");
  const js = await Deno.readTextFile(appPath);

  assert(
    js.includes("initTouchTooltips"),
    `Expected ${appPath} to initialise touch tooltips`,
  );
  assert(
    js.includes("touchstart") || js.includes("pointerdown"),
    `Expected ${appPath} to listen for touch/pointer events`,
  );
  assert(
    js.includes("touchTooltip"),
    `Expected ${appPath} to create a tooltip UI container`,
  );
  assert(
    js.includes('document.addEventListener(\n    "click"') ||
      js.includes('document.addEventListener("click"'),
    `Expected ${appPath} to listen for click events (tap-to-show tooltips)`,
  );
  assert(
    js.includes("isKnownTooltipEl") || js.includes("hasTooltip") ||
      js.includes('classList?.contains("stat")'),
    `Expected ${appPath} to scope tap-to-show tooltips to known tooltip elements`,
  );
  assert(
    js.includes("suppressClickUntil") &&
      js.includes("Date.now() < suppressClickUntil"),
    `Expected ${appPath} to suppress click toggling within suppressClickUntil window`,
  );

  const cssPath = repoPath("docs", "styles.css");
  const css = await Deno.readTextFile(cssPath);
  assert(
    css.includes(".touchTooltip"),
    `Expected ${cssPath} to style the touch tooltip UI`,
  );
});
