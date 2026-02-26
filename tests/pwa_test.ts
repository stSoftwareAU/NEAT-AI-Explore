import { assert, assertEquals } from "./test_helpers.ts";

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
  const paths = [
    repoPath("docs", "manifest.webmanifest"),
    repoPath("docs", "sw.js"),
    repoPath("docs", "index.html"),
    repoPath("docs", "impact_attribution.js"),
    repoPath("docs", "favicon.ico"),
    repoPath("docs", "graph", "index.html"),
    repoPath("docs", "graph", "graph.js"),
    repoPath("docs", "graph", "graph.css"),
    repoPath("docs", "starfield", "index.html"),
    repoPath("docs", "starfield", "starfield.js"),
    repoPath("docs", "starfield", "starfield.css"),
    repoPath("docs", "shared", "snapshot_loader.js"),
    repoPath("docs", "shared", "theme.js"),
    repoPath("docs", "shared", "colour_maps.js"),
  ];
  for (const p of paths) {
    await Deno.stat(p);
  }
});

Deno.test("service worker caches starfield files", async () => {
  const swPath = repoPath("docs", "sw.js");
  const swSource = await Deno.readTextFile(swPath);

  const requiredPaths = [
    "./starfield/index.html",
    "./starfield/starfield.js",
    "./starfield/starfield.css",
  ];

  for (const path of requiredPaths) {
    assert(
      swSource.includes(path),
      `sw.js STATIC_FILES should include "${path}"`,
    );
  }
});

Deno.test("service worker handles starfield navigation", async () => {
  const swPath = repoPath("docs", "sw.js");
  const swSource = await Deno.readTextFile(swPath);

  // The SW should have a navigation handler that recognises starfield URLs
  assert(
    swSource.includes("starfield"),
    "sw.js should handle starfield navigation",
  );
  assert(
    swSource.includes("./starfield/index.html"),
    "sw.js should serve starfield/index.html for starfield navigation",
  );
});

Deno.test("manifest icons use single-purpose values", async () => {
  const manifestPath = repoPath("docs", "manifest.webmanifest");
  const manifest = JSON.parse(await Deno.readTextFile(manifestPath));

  for (const icon of manifest.icons) {
    assert(
      typeof icon.purpose === "string",
      `Icon ${icon.src} should have a purpose field`,
    );
    // Each icon entry should have exactly one purpose, not "any maskable"
    const purposes = icon.purpose.split(/\s+/);
    assertEquals(
      purposes.length,
      1,
      `Icon ${icon.src} should have a single purpose value, got "${icon.purpose}"`,
    );
    assert(
      purposes[0] === "any" || purposes[0] === "maskable",
      `Icon ${icon.src} purpose should be "any" or "maskable", got "${
        purposes[0]
      }"`,
    );
  }
});

Deno.test("manifest icons and screenshots exist on disk", async () => {
  const manifestPath = repoPath("docs", "manifest.webmanifest");
  const manifest = JSON.parse(await Deno.readTextFile(manifestPath));

  assert(Array.isArray(manifest.icons), "manifest.icons should be an array");
  assert(
    Array.isArray(manifest.screenshots),
    "manifest.screenshots should be an array",
  );

  for (const icon of manifest.icons) {
    assert(typeof icon.src === "string");
    await Deno.stat(repoPath("docs", icon.src));
  }

  for (const shot of manifest.screenshots) {
    assert(typeof shot.src === "string");
    await Deno.stat(repoPath("docs", shot.src));
  }
});
