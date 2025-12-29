function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  // .../tests/cache_put_awaited_test.ts -> repo root
  const root = here.replace(/\/tests\/cache_put_awaited_test\.ts$/, "");
  return [root, ...parts].join("/");
}

Deno.test("snapshot cache write is awaited so failures are caught (Issue #24, 29-Dec-2025)", async () => {
  const appPath = repoPath("docs", "app.js");
  const js = await Deno.readTextFile(appPath);

  // `Cache.put()` is async and can reject; we must `await` it inside our
  // try/catch so errors are handled gracefully instead of becoming unhandled
  // rejections or silent failures.
  assert(
    js.includes("await cache.put"),
    `Expected ${appPath} to await cache.put(...)`,
  );
});
