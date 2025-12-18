function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function assertEquals<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new Error(
      message ??
        `Assertion failed: expected ${JSON.stringify(expected)} but got ${
          JSON.stringify(actual)
        }`,
    );
  }
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  // .../tests/pwa_test.ts -> repo root
  const root = here.replace(/\/tests\/pwa_test\.ts$/, "");
  return [root, ...parts].join("/");
}

Deno.test("docs PWA files exist", async () => {
  const manifestPath = repoPath("docs", "manifest.webmanifest");
  const swPath = repoPath("docs", "sw.js");
  const indexPath = repoPath("docs", "index.html");
  const impactPath = repoPath("docs", "impact_attribution.js");

  await Deno.stat(manifestPath);
  await Deno.stat(swPath);
  await Deno.stat(indexPath);
  await Deno.stat(impactPath);
});

Deno.test("manifest icons and screenshots exist on disk", async () => {
  const manifestPath = repoPath("docs", "manifest.webmanifest");
  const manifest = JSON.parse(await Deno.readTextFile(manifestPath));

  assert(Array.isArray(manifest.icons));
  assert(Array.isArray(manifest.screenshots));

  for (const icon of manifest.icons) {
    assert(typeof icon.src === "string");
    await Deno.stat(repoPath("docs", icon.src));
  }

  for (const shot of manifest.screenshots) {
    assert(typeof shot.src === "string");
    await Deno.stat(repoPath("docs", shot.src));
  }
});

Deno.test("service worker caches the app shell", async () => {
  const swPath = repoPath("docs", "sw.js");
  const sw = await Deno.readTextFile(swPath);

  // Basic sanity checks - we want the install-time cache list to include these.
  for (
    const mustInclude of [
      '"./index.html"',
      "`./styles.css?v=${VERSION}`",
      "`./app.js?v=${VERSION}`",
      '"./impact_attribution.js"',
      '"./impact_diagnostics.js"',
      '"./manifest.webmanifest"',
      '"./icons/icon-192x192.png"',
      '"./Tooltips.json"',
    ]
  ) {
    assert(
      sw.includes(mustInclude),
      `Expected service worker to include ${mustInclude} in STATIC_FILES`,
    );
  }
});

Deno.test("app loads Tooltips.json (not aliases.json)", async () => {
  const appPath = repoPath("docs", "app.js");
  const js = await Deno.readTextFile(appPath);

  assert(
    js.includes("./Tooltips.json"),
    "Expected docs/app.js to fetch ./Tooltips.json",
  );
  assert(
    !js.includes("./aliases.json"),
    "Expected docs/app.js to not fetch ./aliases.json",
  );
});

Deno.test("docs/index.html links manifest and registers service worker", async () => {
  const indexPath = repoPath("docs", "index.html");
  const html = await Deno.readTextFile(indexPath);

  assert(html.includes('rel="manifest"'));
  assert(html.includes("./manifest.webmanifest"));
  assert(html.includes("navigator.serviceWorker.register"));
  assertEquals(html.includes("./sw.js"), true);
  assert(
    html.includes("app.js?v=__BUILD_ID__"),
    "Expected docs/index.html to cache-bust app.js with __BUILD_ID__",
  );
  assert(
    html.includes("styles.css?v=__BUILD_ID__"),
    "Expected docs/index.html to cache-bust styles.css with __BUILD_ID__",
  );
  assert(
    html.includes("sw.js?v=__BUILD_ID__"),
    "Expected docs/index.html to cache-bust sw.js with __BUILD_ID__",
  );
});
