function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  // .../tests/network_cache_fallback_test.ts -> repo root
  const root = here.replace(/\/tests\/network_cache_fallback_test\.ts$/, "");
  return [root, ...parts].join("/");
}

Deno.test("app uses network-first snapshot fetch with cache fallback + UI indicator (Issue #22 follow-up, 29-Dec-2025)", async () => {
  const appPath = repoPath("docs", "app.js");
  const cssPath = repoPath("docs", "styles.css");
  const js = await Deno.readTextFile(appPath);
  const css = await Deno.readTextFile(cssPath);

  // Offline behaviour: attempt a live fetch first, but fall back to Cache Storage
  // when the network isn't available.
  assert(
    js.includes("caches.match") || js.includes("caches.open"),
    `Expected ${appPath} to use Cache Storage for offline fallback`,
  );

  // UI: show a clear hint when cached data was used.
  assert(
    js.toLowerCase().includes("cached"),
    `Expected ${appPath} to include a 'cached' indicator in status text`,
  );
  assert(
    css.includes(".statusInline.warn"),
    `Expected ${cssPath} to style a warning status state for cached loads`,
  );
});
