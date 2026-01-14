/**
 * Test for Issue #74: The path should be moved up.
 *
 * Requirements:
 * 1. The "trace" label should be renamed to a more meaningful term ("Path")
 * 2. The path should be styled differently from the label
 * 3. When the path is too long, it should truncate in the middle (preserving
 *    start and end which are the most important)
 */

function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  const root = here.replace(/\/tests\/navigation_path_display_test\.ts$/, "");
  return [root, ...parts].join("/");
}

Deno.test("index.html uses 'Path:' label instead of 'Trace:'", async () => {
  const p = repoPath("docs", "index.html");
  const html = await Deno.readTextFile(p);

  // The label should now say "Path:" instead of "Trace:"
  assert(
    html.includes(">Path:</") || html.includes(">Path<"),
    `Expected ${p} to have 'Path:' label (more meaningful than 'Trace:')`,
  );

  // "Trace:" as a label should no longer be present in the nav bar
  // (Note: "trace" may still appear in class names or IDs, which is fine)
  assert(
    !html.includes(">Trace:</") && !html.includes(">Trace<"),
    `Expected ${p} to NOT have 'Trace:' as a visible label`,
  );
});

Deno.test("styles.css has distinct styling for path label vs path content", async () => {
  const p = repoPath("docs", "styles.css");
  const css = await Deno.readTextFile(p);

  // The path label should have its own CSS class with distinct styling
  assert(
    css.includes(".pathLabel") || css.includes(".traceLabel"),
    `Expected ${p} to have a CSS class for the path label`,
  );

  // The path content (breadcrumb) should have a different colour from the label
  // The label uses --trace colour; the breadcrumb buttons should use --accent
  assert(
    css.includes(".breadcrumb button") &&
      css.includes("color: var(--accent)"),
    `Expected ${p} to style .breadcrumb buttons with --accent colour`,
  );
});

Deno.test("styles.css has pathLabel class for the navigation label", async () => {
  const p = repoPath("docs", "styles.css");
  const css = await Deno.readTextFile(p);

  // The pathLabel class should exist for styling the "Path:" label
  assert(
    css.includes(".pathLabel"),
    `Expected ${p} to have .pathLabel class for the navigation label`,
  );
});

Deno.test("index.html uses pathLabel class for the Path: label", async () => {
  const p = repoPath("docs", "index.html");
  const html = await Deno.readTextFile(p);

  // The Path: label should use the pathLabel class
  assert(
    html.includes('class="pathLabel"') || html.includes("class='pathLabel'"),
    `Expected ${p} to have a pathLabel class on the Path: label element`,
  );
});

Deno.test("app.js has truncatePathInMiddle function for long paths", async () => {
  const p = repoPath("docs", "app.js");
  const js = await Deno.readTextFile(p);

  // There should be a function to truncate paths in the middle
  // when they're too long (keeping start and end visible)
  assert(
    js.includes("truncatePathInMiddle") ||
      js.includes("truncatePath") ||
      (js.includes("renderTrace") && js.includes("…")),
    `Expected ${p} to have path truncation logic for long navigation paths`,
  );
});

Deno.test("app.js renderTrace handles middle truncation for long paths", async () => {
  const p = repoPath("docs", "app.js");
  const js = await Deno.readTextFile(p);

  // The renderTrace function should handle truncation when there are many items
  // This can be done by:
  // 1. Showing first N items
  // 2. Showing an ellipsis ("…")
  // 3. Showing last M items
  //
  // Check that renderTrace or a related function handles this case
  assert(
    js.includes("renderTrace"),
    `Expected ${p} to have a renderTrace function`,
  );

  // The ellipsis character should be present for truncation indication
  assert(
    js.includes("…"),
    `Expected ${p} to use ellipsis (…) for truncation indication`,
  );
});

Deno.test("app.js renderTrace truncates in the middle for paths longer than threshold", async () => {
  const p = repoPath("docs", "app.js");
  const js = await Deno.readTextFile(p);

  // The renderTrace function should check for path length and truncate in middle
  // Look for logic that:
  // 1. Checks trace.length against a threshold (e.g., MAX_VISIBLE_PATH_ITEMS)
  // 2. Shows first items, ellipsis, then last items when exceeding threshold

  // Check for a threshold constant or inline check for path length
  assert(
    js.includes("MAX_VISIBLE_PATH_ITEMS") ||
      js.includes("maxVisiblePathItems") ||
      (js.includes("renderTrace") && js.includes("trace.length")),
    `Expected ${p} to have logic checking path length for truncation`,
  );
});

Deno.test("styles.css has styling for truncated path ellipsis indicator", async () => {
  const p = repoPath("docs", "styles.css");
  const css = await Deno.readTextFile(p);

  // There should be styling for the ellipsis element in the breadcrumb
  // to indicate truncation
  assert(
    css.includes(".breadcrumbEllipsis") ||
      css.includes(".pathEllipsis") ||
      css.includes(".breadcrumb") && css.includes("li"),
    `Expected ${p} to have styling for truncated path indicator`,
  );
});
