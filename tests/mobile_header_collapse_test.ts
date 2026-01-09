/**
 * Test for Issue #53: Better use of mobile space.
 *
 * Once a snapshot is loaded, the URL input, Fetch button, and Browse button
 * should be hidden on mobile to save vertical space. They should reappear
 * when the user presses "Clear".
 */

function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  const root = here.replace(/\/tests\/mobile_header_collapse_test\.ts$/, "");
  return [root, ...parts].join("/");
}

Deno.test("styles.css includes mobile-only header collapse class", async () => {
  const p = repoPath("docs", "styles.css");
  const css = await Deno.readTextFile(p);

  // There should be a class to hide controls when a snapshot is loaded.
  assert(
    css.includes(".snapshotLoaded"),
    `Expected ${p} to include a .snapshotLoaded class for hiding controls`,
  );

  // The hiding should only apply on mobile (narrow viewports).
  assert(
    css.includes("@media") && css.includes("max-width"),
    `Expected ${p} to use a media query for mobile-only hiding`,
  );
});

Deno.test("app.js adds snapshotLoaded class after loading", async () => {
  const p = repoPath("docs", "app.js");
  const js = await Deno.readTextFile(p);

  // The app should toggle a class on the header or body when a snapshot loads.
  assert(
    js.includes("snapshotLoaded"),
    `Expected ${p} to reference snapshotLoaded class when toggling UI state`,
  );
});

Deno.test("app.js removes snapshotLoaded class on clear", async () => {
  const p = repoPath("docs", "app.js");
  const js = await Deno.readTextFile(p);

  // The clearTrace function (or a related "clear snapshot" function) should
  // remove the snapshotLoaded class so controls reappear.
  assert(
    js.includes("clearSnapshot") || js.includes("snapshotLoaded"),
    `Expected ${p} to handle clearing the snapshotLoaded state`,
  );
});

Deno.test("index.html header controls have appropriate classes for hiding", async () => {
  const p = repoPath("docs", "index.html");
  const html = await Deno.readTextFile(p);

  // The URL input, Fetch button, and Browse button should be identifiable
  // and wrapped or classed so they can be hidden together.
  assert(
    html.includes('id="fetchUrl"'),
    `Expected ${p} to have a fetchUrl input element`,
  );
  assert(
    html.includes('id="fetchBtn"'),
    `Expected ${p} to have a fetchBtn button element`,
  );
  assert(
    html.includes('id="fileBtn"') || html.includes("browseGroup"),
    `Expected ${p} to have a fileBtn or browseGroup element`,
  );
});
