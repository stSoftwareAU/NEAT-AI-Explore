function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  // .../tests/starfield_label_projection_order_test.ts -> repo root
  const root = here.replace(
    /\/tests\/starfield_label_projection_order_test\.ts$/,
    "",
  );
  return [root, ...parts].join("/");
}

Deno.test("starfield forces label projection after layout changes (Issue #25)", async () => {
  const jsPath = repoPath("docs", "starfield", "starfield.js");
  const js = await Deno.readTextFile(jsPath);

  // 1) Focus changes must bypass the 100ms throttle so labels use updated positions.
  assert(
    js.includes("updateLabelsForFocus(focusUuid, { force: true })"),
    "Expected onFocusChanged to force an immediate label re-projection after updating positions.",
  );

  // 2) Mode toggle must not project labels before recomputing the layout.
  const handlerStart = js.indexOf('el.modeToggle.addEventListener("click"');
  assert(handlerStart >= 0, "Expected a mode toggle click handler.");

  const handlerEnd = js.indexOf("});", handlerStart);
  assert(
    handlerEnd > handlerStart,
    "Expected to find end of mode toggle handler.",
  );

  const handler = js.slice(handlerStart, handlerEnd);
  const focusChangedIdx = handler.indexOf("renderer.onFocusChanged");
  assert(
    focusChangedIdx >= 0,
    "Expected mode toggle handler to call onFocusChanged.",
  );

  const beforeFocusChanged = handler.slice(0, focusChangedIdx);
  assert(
    !beforeFocusChanged.includes("updateLabelsForFocus"),
    "Expected mode toggle handler not to update labels before onFocusChanged recomputes positions.",
  );
});
