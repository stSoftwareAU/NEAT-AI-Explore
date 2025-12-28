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

  // Toggle-to-close must work on touch devices. `touchstart` fires before `click`,
  // so we must not clear the "currently shown for" state during `touchstart`,
  // otherwise the click handler can never detect a second tap on the same target.
  const touchstartIdx = js.indexOf(
    'document.addEventListener(\n    "touchstart"',
  );
  const findTargetIdx = js.indexOf(
    "const target = findTooltipTarget(e.target);",
  );
  assert(
    touchstartIdx >= 0 && findTargetIdx > touchstartIdx,
    `Expected ${appPath} to include a touchstart handler that looks up tooltip targets`,
  );
  const between = js.slice(touchstartIdx, findTargetIdx);
  assert(
    !between.includes("shownForTarget = null"),
    `Expected ${appPath} not to clear shownForTarget during touchstart (would break toggle-to-close)`,
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

  // When a tooltip is open, touching a tooltip target should not be treated as an
  // "outside" touch-close event, otherwise a tap-to-toggle will close on touchstart
  // then immediately re-open on click.
  const outsideTouchIdx = js.indexOf(
    "// Tap anywhere outside the tooltip to close it.",
  );
  assert(
    outsideTouchIdx >= 0,
    `Expected ${appPath} to include the outside-touch close handler`,
  );
  const outsideTouchGuardIdx = js.indexOf(
    "if (findTooltipTarget(e.target)) return;",
    outsideTouchIdx,
  );
  assert(
    outsideTouchGuardIdx > outsideTouchIdx,
    `Expected ${appPath} outside-touch close handler to ignore tooltip targets (avoid close-then-reopen race)`,
  );
  const outsideClickIdx = js.indexOf("Support outside-click close as well");
  assert(
    outsideClickIdx >= 0,
    `Expected ${appPath} to include the outside-click-close handler`,
  );
  const outsideGuardIdx = js.indexOf(
    "if (findTooltipTarget(e.target)) return;",
    outsideClickIdx,
  );
  assert(
    outsideGuardIdx > outsideClickIdx,
    `Expected ${appPath} outside-click-close handler to ignore tooltip targets (avoid open-then-close race)`,
  );

  const cssPath = repoPath("docs", "styles.css");
  const css = await Deno.readTextFile(cssPath);
  assert(
    css.includes(".touchTooltip"),
    `Expected ${cssPath} to style the touch tooltip UI`,
  );
});
