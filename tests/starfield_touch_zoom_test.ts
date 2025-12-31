function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  // .../tests/starfield_touch_zoom_test.ts -> repo root
  const root = here.replace(/\/tests\/starfield_touch_zoom_test\.ts$/, "");
  return [root, ...parts].join("/");
}

Deno.test("starfield supports pinch-to-zoom on touch devices (Issue #39, 31-Dec-2025)", async () => {
  const jsPath = repoPath("docs", "starfield", "starfield.js");
  const js = await Deno.readTextFile(jsPath);

  assert(
    js.includes("pinch") && js.includes("zoomBy"),
    "Expected starfield.js to include pinch state and zoomBy helper",
  );
  assert(
    js.includes("touches") && js.includes("ts.length >= 2"),
    "Expected starfield.js to detect multi-touch for pinch zoom",
  );
  assert(
    /if\s*\(ts\.length\s*>=\s*2\)\s*\{[\s\S]{0,400}this\.pinch\.active[\s\S]{0,400}zoomBy/
      .test(
        js,
      ),
    "Expected touchmove pinch branch to be gated by pinch.active to avoid zoom jumps",
  );
  assert(
    js.includes('addEventListener("touchmove"') &&
      js.includes("passive: false"),
    "Expected touchmove handler to be non-passive so it can preventDefault",
  );
  assert(
    js.includes("e.preventDefault()"),
    "Expected touchmove handler to call preventDefault to stop browser scroll/zoom",
  );
});

Deno.test("starfield canvas disables browser gesture handling (touch-action: none) (Issue #39, 31-Dec-2025)", async () => {
  const cssPath = repoPath("docs", "starfield", "starfield.css");
  const css = await Deno.readTextFile(cssPath);

  assert(
    css.includes(".glCanvas") && css.includes("touch-action: none"),
    "Expected starfield.css to set touch-action: none on the canvas",
  );
});

Deno.test("starfield does not activate drag/pinch if a touch gesture started off-canvas (Issue #41, 31-Dec-2025)", async () => {
  const jsPath = repoPath("docs", "starfield", "starfield.js");
  const js = await Deno.readTextFile(jsPath);

  assert(
    js.includes("startedOnCanvas"),
    "Expected starfield.js to track whether a touch gesture started on the canvas",
  );
  assert(
    js.includes('addEventListener("touchend"'),
    "Expected starfield.js to bind a touchend handler",
  );
  assert(
    js.includes("if (!this.touch.startedOnCanvas)"),
    "Expected touchend handler to bail out when the touch gesture started off-canvas",
  );
});

Deno.test("starfield tracks touch origin as the first touch only (not any touch) (Issue #42, 31-Dec-2025)", async () => {
  const jsPath = repoPath("docs", "starfield", "starfield.js");
  const js = await Deno.readTextFile(jsPath);

  assert(
    /window\.addEventListener\([\s\S]{0,80}"touchstart"/.test(js),
    "Expected starfield.js to listen for touchstart at window scope to track gesture origin",
  );
  assert(
    js.includes("ts.length === 1") || js.includes("ts.length==1"),
    "Expected starfield.js to treat the 0→1 touch transition as the gesture origin",
  );

  // If the gesture starts off-canvas and a later touch begins on-canvas, the
  // canvas touchstart event fires with multiple touches present. In that case,
  // we must NOT flip startedOnCanvas to true.
  const canvasStart = js.indexOf('c.addEventListener("touchstart"');
  assert(canvasStart !== -1, "Expected starfield.js to bind canvas touchstart");
  const canvasEnd = js.indexOf("}, { passive: false });", canvasStart);
  assert(
    canvasEnd !== -1,
    "Expected starfield.js canvas touchstart handler to end with passive: false options",
  );
  const canvasHandler = js.slice(canvasStart, canvasEnd);
  assert(
    !/startedOnCanvas\s*=/.test(canvasHandler),
    "Expected canvas touchstart handler to not assign startedOnCanvas (origin must be tracked from the first touch only)",
  );
});
