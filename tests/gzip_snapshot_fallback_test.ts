function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  // .../tests/gzip_snapshot_fallback_test.ts -> repo root
  const root = here.replace(/\/tests\/gzip_snapshot_fallback_test\.ts$/, "");
  return [root, ...parts].join("/");
}

Deno.test("app can gunzip .json.gz even without DecompressionStream (iOS Safari fallback)", async () => {
  const appPath = repoPath("docs", "app.js");
  const js = await Deno.readTextFile(appPath);

  assert(
    js.includes("gunzipSync") || js.includes("gunzip"),
    `Expected ${appPath} to include an fflate gunzip fallback`,
  );

  assert(
    js.includes("./vendor/fflate.browser.js"),
    `Expected ${appPath} to import ./vendor/fflate.browser.js for gzip fallback`,
  );

  const swPath = repoPath("docs", "sw.js");
  const sw = await Deno.readTextFile(swPath);

  assert(
    sw.includes('"./vendor/fflate.browser.js"'),
    `Expected ${swPath} to cache ./vendor/fflate.browser.js as part of the app shell`,
  );
});
