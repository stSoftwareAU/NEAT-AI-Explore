/**
 * Regression test: `__loadedFromCache` must not be used as a transport field
 * between `fetchJson` and `loadSnapshot`, because it can collide with real user
 * snapshot data (e.g. when loading a local JSON file).
 *
 * Issue #25: 29-Dec-2025
 */

function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  // .../tests/loaded_from_cache_collision_test.ts -> repo root
  const root = here.replace(
    /\/tests\/loaded_from_cache_collision_test\.ts$/,
    "",
  );
  return [root, ...parts].join("/");
}

Deno.test("app must not treat user __loadedFromCache property as cache metadata (Issue #25, 29-Dec-2025)", async () => {
  const appPath = repoPath("docs", "app.js");
  const js = await Deno.readTextFile(appPath);

  // If a user loads a local snapshot object via `loadSnapshot(obj, name)`,
  // any `__loadedFromCache` property in their data must be left untouched.
  // Using a Symbol (or similarly non-serialisable token) avoids collisions.
  assert(
    !js.includes("__loadedFromCache"),
    `Expected ${appPath} to avoid using __loadedFromCache (collides with user snapshot data)`,
  );
});
