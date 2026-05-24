import { assert } from "./test_helpers.ts";

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
    repoPath("docs", "shared", "snapshot_loader.js"),
    repoPath("docs", "shared", "theme.js"),
    repoPath("docs", "shared", "colour_maps.js"),
    repoPath("docs", "starfield", "index.html"),
    repoPath("docs", "starfield", "starfield.js"),
    repoPath("docs", "starfield", "starfield.css"),
    // Boot scripts extracted from inline <script> blocks for the CSP in #218.
    repoPath("docs", "boot.js"),
    repoPath("docs", "graph", "boot.js"),
    repoPath("docs", "starfield", "boot.js"),
  ];
  for (const p of paths) {
    await Deno.stat(p);
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

Deno.test("sw.js STATIC_FILES includes starfield assets", async () => {
  const swPath = repoPath("docs", "sw.js");
  const swContent = await Deno.readTextFile(swPath);
  const starfieldFiles = [
    "./starfield/index.html",
    "./starfield/starfield.js",
    "./starfield/starfield.css",
  ];
  for (const file of starfieldFiles) {
    assert(
      swContent.includes(file),
      `sw.js STATIC_FILES should include ${file}`,
    );
  }
});

Deno.test("sw.js has starfield navigation handler", async () => {
  const swPath = repoPath("docs", "sw.js");
  const swContent = await Deno.readTextFile(swPath);
  assert(
    swContent.includes("starfield"),
    "sw.js should contain a starfield navigation handler",
  );
});

Deno.test("sw.js STATIC_FILES precaches the per-page boot.js scripts (#218)", async () => {
  const swPath = repoPath("docs", "sw.js");
  const swContent = await Deno.readTextFile(swPath);
  // CSP `script-src 'self'` requires the boot scripts to be fetched, never
  // inlined. They must therefore be precached so the PWA still boots offline.
  const bootFiles = [
    "./boot.js?v=${VERSION}",
    "./graph/boot.js?v=${VERSION}",
    "./starfield/boot.js?v=${VERSION}",
  ];
  for (const file of bootFiles) {
    assert(
      swContent.includes(file),
      `sw.js STATIC_FILES should include ${file}`,
    );
  }
});

Deno.test("inject_build_id.ts substitutes __BUILD_ID__ in every entry HTML and boot.js (#218)", async () => {
  const scriptPath = repoPath("scripts", "inject_build_id.ts");
  const content = await Deno.readTextFile(scriptPath);
  // Boot scripts contain the same __BUILD_ID__ placeholder the HTML used to
  // hold inline. They must be on the substitution list so production deploys
  // get a stable cache buster (not the Date.now() dev fallback).
  const required = [
    "./docs/index.html",
    "./docs/boot.js",
    "./docs/graph/index.html",
    "./docs/graph/boot.js",
    "./docs/starfield/index.html",
    "./docs/starfield/boot.js",
    "./docs/sw.js",
  ];
  for (const file of required) {
    assert(
      content.includes(`"${file}"`),
      `inject_build_id.ts files[] should include "${file}"`,
    );
  }
});

Deno.test("manifest icons use single-purpose values", async () => {
  const manifestPath = repoPath("docs", "manifest.webmanifest");
  const manifest = JSON.parse(await Deno.readTextFile(manifestPath));
  for (const icon of manifest.icons) {
    const purpose = icon.purpose ?? "any";
    // Each icon entry should have exactly one purpose value
    assert(
      !purpose.includes(" "),
      `Icon ${icon.src} should have a single purpose value, got "${purpose}"`,
    );
    assert(
      purpose === "any" || purpose === "maskable",
      `Icon ${icon.src} purpose should be "any" or "maskable", got "${purpose}"`,
    );
  }
});
