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
