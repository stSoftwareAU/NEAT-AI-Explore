function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  // .../tests/loaded_from_cache_type_guard_test.ts -> repo root
  const root = here.replace(
    /\/tests\/loaded_from_cache_type_guard_test\.ts$/,
    "",
  );
  return [root, ...parts].join("/");
}

Deno.test("loaded-from-cache annotation is type-guarded (Issue #22 follow-up, 29-Dec-2025)", async () => {
  const appPath = repoPath("docs", "app.js");
  const js = await Deno.readTextFile(appPath);

  // In strict mode, `JSON.parse()` can legitimately return `null` or a primitive.
  // We must never set properties on that value without a type guard.
  assert(
    js.includes('usedCache && obj && typeof obj === "object"'),
    `Expected ${appPath} to type-guard before annotating cache metadata`,
  );

  // Cache metadata transport must not collide with user snapshot data.
  // A Symbol avoids collisions because it cannot appear in JSON.
  assert(
    !js.includes("__loadedFromCache"),
    `Expected ${appPath} to avoid using __loadedFromCache (can collide with user snapshot JSON)`,
  );
});
