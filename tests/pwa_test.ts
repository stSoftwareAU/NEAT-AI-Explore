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

Deno.test("version.json exists and is SemVer X.Y.Z", async () => {
  const versionPath = repoPath("version.json");
  const obj = JSON.parse(await Deno.readTextFile(versionPath));
  const v = obj?.version;
  assert(
    typeof v === "string",
    "Expected version.json to have a string 'version'",
  );
  assert(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(v),
    "Expected version.json version to be SemVer X.Y.Z",
  );
});

Deno.test("docs PWA files exist", async () => {
  const manifestPath = repoPath("docs", "manifest.webmanifest");
  const swPath = repoPath("docs", "sw.js");
  const indexPath = repoPath("docs", "index.html");
  const impactPath = repoPath("docs", "impact_attribution.js");
  const faviconPath = repoPath("docs", "favicon.ico");
  const starfieldIndexPath = repoPath("docs", "starfield", "index.html");
  const starfieldJsPath = repoPath("docs", "starfield", "starfield.js");
  const starfieldCssPath = repoPath("docs", "starfield", "starfield.css");
  const sharedSnapshotLoaderPath = repoPath(
    "docs",
    "shared",
    "snapshot_loader.js",
  );
  const sharedThemePath = repoPath("docs", "shared", "theme.js");
  const sharedColourMapsPath = repoPath("docs", "shared", "colour_maps.js");

  await Deno.stat(manifestPath);
  await Deno.stat(swPath);
  await Deno.stat(indexPath);
  await Deno.stat(impactPath);
  await Deno.stat(faviconPath);
  await Deno.stat(starfieldIndexPath);
  await Deno.stat(starfieldJsPath);
  await Deno.stat(starfieldCssPath);
  await Deno.stat(sharedSnapshotLoaderPath);
  await Deno.stat(sharedThemePath);
  await Deno.stat(sharedColourMapsPath);
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
      '"./favicon.ico"',
      '"./icons/icon-192x192.png"',
      '"./starfield/index.html"',
      "`./starfield/starfield.js?v=${VERSION}`",
      "`./starfield/starfield.css?v=${VERSION}`",
      '"./shared/snapshot_loader.js"',
      '"./shared/theme.js"',
      '"./shared/colour_maps.js"',
    ]
  ) {
    assert(
      sw.includes(mustInclude),
      `Expected service worker to include ${mustInclude} in STATIC_FILES`,
    );
  }

  // Ensure navigation routing serves the correct app shell for /starfield/.
  assert(
    sw.includes('request.mode === "navigate"'),
    "Expected service worker to handle navigation requests",
  );
  assert(
    sw.includes("./starfield/index.html"),
    "Expected service worker to route /starfield/ navigations to ./starfield/index.html",
  );
});

Deno.test("app loads tooltips from snapshot (not Tooltips.json)", async () => {
  const appPath = repoPath("docs", "app.js");
  const js = await Deno.readTextFile(appPath);

  assert(
    !js.includes("./Tooltips.json"),
    "Expected docs/app.js to not fetch ./Tooltips.json",
  );
  assert(
    js.includes("snapshot?.tooltips") ||
      js.includes("loadInputLabelsFromSnapshot"),
    "Expected docs/app.js to read tooltips from the snapshot payload",
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
  assert(
    html.includes('rel="icon"') || html.includes('rel="shortcut icon"'),
    'Expected docs/index.html to include a favicon <link rel="icon" ...>',
  );
  assert(
    html.includes("./favicon.ico") ||
      html.includes('href="favicon.ico"') ||
      html.includes('href="favicon.ico?'),
    'Expected docs/index.html to reference "./favicon.ico"',
  );
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

Deno.test("docs/starfield/index.html links manifest and registers service worker", async () => {
  const indexPath = repoPath("docs", "starfield", "index.html");
  const html = await Deno.readTextFile(indexPath);

  assert(
    html.includes('rel="manifest"'),
    "Expected docs/starfield/index.html to include a web manifest <link>",
  );
  assert(
    html.includes("../manifest.webmanifest"),
    'Expected docs/starfield/index.html to reference "../manifest.webmanifest"',
  );
  assert(
    html.includes('rel="icon"') || html.includes('rel="shortcut icon"'),
    'Expected docs/starfield/index.html to include a favicon <link rel="icon" ...>',
  );
  assert(
    html.includes("../favicon.ico"),
    'Expected docs/starfield/index.html to reference "../favicon.ico"',
  );
  assert(
    html.includes("navigator.serviceWorker.register"),
    "Expected docs/starfield/index.html to register a service worker",
  );
  assert(
    html.includes("../sw.js"),
    'Expected docs/starfield/index.html to reference "../sw.js"',
  );
  assert(
    html.includes("starfield.js?v=__BUILD_ID__"),
    "Expected docs/starfield/index.html to cache-bust starfield.js with __BUILD_ID__",
  );
  assert(
    html.includes("starfield.css?v=__BUILD_ID__"),
    "Expected docs/starfield/index.html to cache-bust starfield.css with __BUILD_ID__",
  );
  assert(
    html.includes("sw.js?v=__BUILD_ID__"),
    "Expected docs/starfield/index.html to cache-bust sw.js with __BUILD_ID__",
  );
});
