/**
 * Test for Issue #59: Trace doesn't fit in portrait mode.
 *
 * On narrow portrait-mode screens (e.g., iPhone in portrait), the trace bar
 * should wrap its buttons to a second row so that the breadcrumb and controls
 * all fit without horizontal overflow.
 */

function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  const root = here.replace(/\/tests\/trace_bar_portrait_mode_test\.ts$/, "");
  return [root, ...parts].join("/");
}

Deno.test("styles.css includes trace bar button wrapping for narrow screens", async () => {
  const p = repoPath("docs", "styles.css");
  const css = await Deno.readTextFile(p);

  // The trace bar should use flex-wrap to allow buttons to wrap to a new row
  // on narrow screens. Check that the 520px breakpoint handles this.
  assert(
    css.includes("@media (max-width: 520px)"),
    `Expected ${p} to include a max-width: 520px breakpoint`,
  );

  // The trace bar buttons should be able to wrap to their own row
  // when the breadcrumb takes up too much space.
  assert(
    css.includes(".traceBar") && css.includes("flex-wrap"),
    `Expected ${p} to include flex-wrap for .traceBar`,
  );
});

Deno.test("index.html trace bar buttons are grouped for wrapping", async () => {
  const p = repoPath("docs", "index.html");
  const html = await Deno.readTextFile(p);

  // The trace bar should have identifiable buttons that can be wrapped.
  assert(
    html.includes('id="traceBackBtn"'),
    `Expected ${p} to have a traceBackBtn button element`,
  );
  assert(
    html.includes('id="traceClearBtn"'),
    `Expected ${p} to have a traceClearBtn button element`,
  );
  assert(
    html.includes('id="obsBtn"'),
    `Expected ${p} to have an obsBtn button element`,
  );
  assert(
    html.includes('id="graphBtn"'),
    `Expected ${p} to have a graphBtn button element`,
  );

  // The buttons should be grouped together in a wrapper div so they can
  // wrap as a unit on narrow screens.
  assert(
    html.includes("traceButtons"),
    `Expected ${p} to have a traceButtons wrapper for trace bar buttons`,
  );
});

Deno.test("styles.css includes trace buttons container styling for mobile", async () => {
  const p = repoPath("docs", "styles.css");
  const css = await Deno.readTextFile(p);

  // The trace buttons container should be styled to group buttons together
  // and allow them to wrap as a unit on narrow screens.
  assert(
    css.includes(".traceButtons"),
    `Expected ${p} to have .traceButtons class for grouping trace bar buttons`,
  );

  // The buttons container should use flexbox for layout.
  assert(
    css.includes(".traceButtons") && css.includes("display: flex"),
    `Expected ${p} to have display: flex for .traceButtons`,
  );
});

Deno.test("styles.css forces breadcrumb to full width on narrow mobile screens", async () => {
  const p = repoPath("docs", "styles.css");
  const css = await Deno.readTextFile(p);

  // On very narrow screens (520px), the breadcrumb should take full width
  // so that buttons wrap to a new row below it.
  assert(
    css.includes("@media (max-width: 520px)"),
    `Expected ${p} to include a max-width: 520px breakpoint`,
  );

  // The breadcrumb should force a wrap by taking full width on mobile.
  // This can be achieved with flex-basis: 100% or width: 100%.
  assert(
    css.includes(".breadcrumb") &&
      (css.includes("flex: 1 1 100%") || css.includes("flex-basis: 100%") ||
        css.includes("width: 100%")),
    `Expected ${p} to allow .breadcrumb to take full width on narrow screens`,
  );
});
