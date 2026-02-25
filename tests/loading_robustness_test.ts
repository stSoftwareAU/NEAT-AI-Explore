/**
 * Tests for loading robustness (Issue #126).
 *
 * Verifies that:
 * 1. The Service Worker pre-caches all modules that app.js imports.
 * 2. The bootstrap script in index.html has error handling on the dynamic
 *    import so users see a visible error when loading fails.
 * 3. A pre-JS loading indicator exists so the user sees something immediately.
 */

import { assert } from "./test_helpers.ts";

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  const root = here.replace(/\/tests\/loading_robustness_test\.ts$/, "");
  return [root, ...parts].join("/");
}

/**
 * Extract ES module import paths from a JS file's import statements.
 * Returns relative paths like "./shared/config.js".
 */
function extractImportPaths(source: string): string[] {
  const paths: string[] = [];
  // Match: import { ... } from "path";  and  import "path";
  const re = /\bfrom\s+["']([^"']+)["']|import\s+["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const p = m[1] ?? m[2];
    if (p && p.startsWith("./")) paths.push(p);
  }
  return paths;
}

Deno.test("SW STATIC_FILES includes all modules imported by app.js", async () => {
  const appSource = await Deno.readTextFile(repoPath("docs", "app.js"));
  const swSource = await Deno.readTextFile(repoPath("docs", "sw.js"));

  const appImports = extractImportPaths(appSource);
  assert(appImports.length > 0, "app.js should have imports");

  // SW uses template literals like `./app.js?v=${VERSION}` — strip any
  // query-string / template suffix for comparison.
  const swEntries = swSource.match(/["'`]\.\/.+?["'`]/g) ?? [];
  const swPaths = new Set(
    swEntries.map((e) =>
      e.slice(1, -1).replace(/\?v=.*$/, "").replace(/\$\{.*?\}/, "")
    ),
  );

  const missing: string[] = [];
  for (const imp of appImports) {
    if (!swPaths.has(imp)) missing.push(imp);
  }

  assert(
    missing.length === 0,
    `SW STATIC_FILES is missing modules imported by app.js: ${
      missing.join(", ")
    }`,
  );
});

Deno.test("index.html has error handling on dynamic import", async () => {
  const html = await Deno.readTextFile(repoPath("docs", "index.html"));

  // The dynamic import of app.js should be wrapped in try/catch.
  assert(
    html.includes("catch") && html.includes("import("),
    "index.html should have a catch handler around the dynamic import",
  );
});

Deno.test("index.html shows a pre-JS loading indicator", async () => {
  const html = await Deno.readTextFile(repoPath("docs", "index.html"));

  // The status span should have default text content so users see something
  // before JavaScript has loaded.
  assert(
    /id="status"[^>]*>[^<]+</.test(html),
    "status element should have default text content for pre-JS feedback",
  );
});

Deno.test("index.html has a global error handler for unhandled errors", async () => {
  const html = await Deno.readTextFile(repoPath("docs", "index.html"));

  assert(
    html.includes("unhandledrejection"),
    "index.html should listen for unhandledrejection events",
  );
});
