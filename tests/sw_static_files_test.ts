import { assert } from "./test_helpers.ts";

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

/** Parse the STATIC_FILES array from sw.js source text. */
function parseStaticFiles(swSource: string): string[] {
  // Extract file paths from the STATIC_FILES array. Paths can be plain
  // strings like "./shared/config.js" or template literals like
  // `./app.js?v=${VERSION}`. We normalise by stripping the query suffix.
  const paths: string[] = [];
  const re = /["'`](\.\/.+?)(?:\?[^"'`]*)?["'`]/g;
  // Only search within the STATIC_FILES array definition.
  const startIdx = swSource.indexOf("const STATIC_FILES");
  const endIdx = swSource.indexOf("];", startIdx);
  if (startIdx < 0 || endIdx < 0) return paths;
  const block = swSource.slice(startIdx, endIdx + 2);
  let m;
  while ((m = re.exec(block)) !== null) {
    paths.push(m[1]);
  }
  return paths;
}

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

Deno.test("index.html has error handling for app module import", async () => {
  const html = await Deno.readTextFile(repoPath("docs", "index.html"));
  // The bootstrap IIFE should have a try-catch around the dynamic import.
  assert(
    html.includes("catch") && html.includes("import("),
    "index.html should wrap the app module import in a try-catch for error visibility",
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
