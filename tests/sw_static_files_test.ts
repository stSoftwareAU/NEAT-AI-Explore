import { assert } from "./test_helpers.ts";
import { parseStaticFiles } from "./pwa_sw_harness.ts";

/**
 * Issue #126: Verify that every shared JS module imported by app.js and
 * graph.js is listed in the Service Worker's STATIC_FILES array.
 *
 * Missing entries cause cacheFirst to serve stale versions after a deploy,
 * which can silently break module imports (e.g., a stale config.js that
 * doesn't export a newly-added constant).
 */

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  const root = here.replace(/\/tests\/sw_static_files_test\.ts$/, "");
  return [root, ...parts].join("/");
}

/** Extract relative import paths from an ES module source file. */
function extractRelativeImports(source: string): string[] {
  const imports: string[] = [];
  const re = /\bfrom\s+["'](\.[^"']+)["']/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    imports.push(m[1]);
  }
  return imports;
}

// parseStaticFiles lives in ./pwa_sw_harness.ts so both this suite and
// pwa_test.ts share one structural parser (Issue #330).

Deno.test("SW STATIC_FILES includes all shared modules imported by app.js", async () => {
  const appSource = await Deno.readTextFile(repoPath("docs", "app.js"));
  const swSource = await Deno.readTextFile(repoPath("docs", "sw.js"));

  const appImports = extractRelativeImports(appSource);
  const staticFiles = parseStaticFiles(swSource);

  // Only check ./shared/ imports — top-level modules like
  // ./impact_attribution.js are also important, but shared modules are the
  // ones most commonly missed.
  const sharedImports = appImports.filter((p) => p.startsWith("./shared/"));

  const missing: string[] = [];
  for (const imp of sharedImports) {
    if (!staticFiles.includes(imp)) {
      missing.push(imp);
    }
  }

  assert(
    missing.length === 0,
    `SW STATIC_FILES is missing shared modules imported by app.js: ${
      missing.join(", ")
    }. Add them to sw.js to prevent stale cache issues after deploys.`,
  );
});

Deno.test("SW STATIC_FILES includes all shared modules imported by graph.js", async () => {
  const graphSource = await Deno.readTextFile(
    repoPath("docs", "graph", "graph.js"),
  );
  const swSource = await Deno.readTextFile(repoPath("docs", "sw.js"));

  const graphImports = extractRelativeImports(graphSource);
  const staticFiles = parseStaticFiles(swSource);

  // graph.js imports from "../shared/..." — normalise to "./shared/..."
  // to match the SW's paths (relative to docs/).
  const sharedImports = graphImports
    .filter((p) => p.startsWith("../shared/"))
    .map((p) => p.replace("../shared/", "./shared/"));

  const missing: string[] = [];
  for (const imp of sharedImports) {
    if (!staticFiles.includes(imp)) {
      missing.push(imp);
    }
  }

  assert(
    missing.length === 0,
    `SW STATIC_FILES is missing shared modules imported by graph.js: ${
      missing.join(", ")
    }. Add them to sw.js to prevent stale cache issues after deploys.`,
  );
});

Deno.test("boot.js has error handling for app module import", async () => {
  // Issue #218: the bootstrap IIFE was moved from an inline <script> in
  // index.html to docs/boot.js so the page can declare `script-src 'self'`
  // without 'unsafe-inline'. The try/catch + dynamic import still belong to
  // the boot script — assert on the new location.
  const boot = await Deno.readTextFile(repoPath("docs", "boot.js"));
  assert(
    boot.includes("catch") && boot.includes("import("),
    "docs/boot.js should wrap the app module import in a try-catch for error visibility",
  );
});

Deno.test("Boot scripts do not tell PWA users to clear browser cache (Issue #194)", async () => {
  // The previous error message ("Failed to load app — please clear your
  // browser cache and reload") was a dead end on installed PWAs (especially
  // iOS), where there is no obvious cache to clear. The replacement is the
  // automatic recovery path via docs/shared/pwa_recovery.js.
  //
  // Issue #218: the recovery wiring moved out of inline <script> blocks and
  // into the extracted boot.js files — check those instead of the HTML.
  const bootScripts = [
    repoPath("docs", "boot.js"),
    repoPath("docs", "graph", "boot.js"),
    repoPath("docs", "starfield", "boot.js"),
  ];
  for (const path of bootScripts) {
    const src = await Deno.readTextFile(path);
    assert(
      !src.includes("please clear your browser cache"),
      `${path} must not instruct PWA users to clear the browser cache`,
    );
    assert(
      src.includes("pwa_recovery.js"),
      `${path} must wire up the PWA recovery helper`,
    );
  }
});

Deno.test("SW STATIC_FILES caches pwa_recovery.js (Issue #194)", async () => {
  const swSource = await Deno.readTextFile(repoPath("docs", "sw.js"));
  const staticFiles = parseStaticFiles(swSource);
  assert(
    staticFiles.includes("./shared/pwa_recovery.js"),
    "sw.js STATIC_FILES must include ./shared/pwa_recovery.js so the recovery helper is reachable offline",
  );
});

Deno.test("index.html shows initial loading status before JS runs", async () => {
  const html = await Deno.readTextFile(repoPath("docs", "index.html"));
  // The status element should have visible text content so users see
  // something before JavaScript executes (Issue #126).
  assert(
    html.includes('id="status"') &&
      /id="status"[^>]*>Loading/.test(html),
    "The #status element should have visible 'Loading…' text before JS runs",
  );
});
