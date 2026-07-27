import { assert, assertEquals } from "./test_helpers.ts";
import { loadServiceWorker, parseStaticFiles } from "./pwa_sw_harness.ts";

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
    repoPath("docs", "dag", "index.html"),
    repoPath("docs", "dag", "dag.js"),
    repoPath("docs", "dag", "dag.css"),
    repoPath("docs", "dag", "boot.js"),
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

Deno.test("sw.js STATIC_FILES precaches starfield assets", async () => {
  // Parse the STATIC_FILES array structurally and assert it contains the
  // resolved starfield paths. This survives reordering, quote-style changes,
  // and the `?v=${VERSION}` cache-busting suffix — unlike a raw source grep.
  const swSource = await Deno.readTextFile(repoPath("docs", "sw.js"));
  const staticFiles = parseStaticFiles(swSource);
  const starfieldFiles = [
    "./starfield/index.html",
    "./starfield/starfield.js",
    "./starfield/starfield.css",
  ];
  for (const file of starfieldFiles) {
    assert(
      staticFiles.includes(file),
      `sw.js STATIC_FILES should precache ${file}`,
    );
  }
});

Deno.test("sw.js navigation handler routes each entry point to its app shell", async () => {
  // Drive the Service Worker's fetch handler with fake navigation requests and
  // assert the shell it actually serves — proving the starfield/graph routing
  // exists and works, rather than that the word "starfield" appears somewhere.
  const swSource = await Deno.readTextFile(repoPath("docs", "sw.js"));
  const sw = loadServiceWorker(swSource);

  assertEquals(
    await sw.resolveNavigation("/starfield/"),
    "./starfield/index.html",
    "navigating under /starfield/ should serve the starfield shell",
  );
  assertEquals(
    await sw.resolveNavigation("/dag/"),
    "./dag/index.html",
    "navigating under /dag/ should serve the layered DAG shell",
  );
  assertEquals(
    await sw.resolveNavigation("/graph/"),
    "./graph/index.html",
    "navigating under /graph/ should serve the graph shell",
  );
  assertEquals(
    await sw.resolveNavigation("/"),
    "./index.html",
    "navigating to the root should serve the explorer shell",
  );
});

Deno.test("sw.js STATIC_FILES precaches the per-page boot.js scripts (#218)", async () => {
  // CSP `script-src 'self'` requires the boot scripts to be fetched, never
  // inlined. They must therefore be precached so the PWA still boots offline.
  // Parse STATIC_FILES so the `?v=${VERSION}` suffix is normalised away.
  const swSource = await Deno.readTextFile(repoPath("docs", "sw.js"));
  const staticFiles = parseStaticFiles(swSource);
  const bootFiles = [
    "./boot.js",
    "./graph/boot.js",
    "./starfield/boot.js",
    "./dag/boot.js",
  ];
  for (const file of bootFiles) {
    assert(
      staticFiles.includes(file),
      `sw.js STATIC_FILES should precache ${file}`,
    );
  }
});

Deno.test("inject_build_id.ts substitutes __BUILD_ID__ across the app shell (#218)", async () => {
  // Run the real script over a temporary fixture tree and assert the
  // placeholder was actually replaced in every output file — a behaviour test,
  // not a grep of the script's files[] array literal.
  const buildId = "abc1234";
  const placeholder = "__BUILD_ID__";
  const expectedFiles = [
    "docs/index.html",
    "docs/boot.js",
    "docs/graph/index.html",
    "docs/graph/boot.js",
    "docs/starfield/index.html",
    "docs/starfield/boot.js",
    "docs/dag/index.html",
    "docs/dag/boot.js",
    "docs/sw.js",
  ];

  const tmp = await Deno.makeTempDir({ prefix: "inject_build_id_" });
  try {
    // Seed each expected output file with the placeholder so the script has
    // something real to rewrite.
    for (const rel of expectedFiles) {
      const abs = `${tmp}/${rel}`;
      await Deno.mkdir(abs.slice(0, abs.lastIndexOf("/")), { recursive: true });
      await Deno.writeTextFile(abs, `// version: ${placeholder}\n`);
    }

    const command = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-read",
        "--allow-write",
        repoPath("scripts", "inject_build_id.ts"),
        buildId,
      ],
      cwd: tmp,
    });
    const { code, stderr } = await command.output();
    assertEquals(
      code,
      0,
      `inject_build_id.ts should exit 0, stderr: ${
        new TextDecoder().decode(stderr)
      }`,
    );

    // Every expected file must have the placeholder replaced with the build ID.
    for (const rel of expectedFiles) {
      const after = await Deno.readTextFile(`${tmp}/${rel}`);
      assert(
        !after.includes(placeholder),
        `${rel} should no longer contain ${placeholder} after injection`,
      );
      assert(
        after.includes(buildId),
        `${rel} should contain the injected build ID after injection`,
      );
    }
  } finally {
    await Deno.remove(tmp, { recursive: true });
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
