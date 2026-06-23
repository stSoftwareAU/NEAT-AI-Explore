import { assert } from "./test_helpers.ts";
import { loadDocument } from "./dom_helpers.ts";
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

// Issue #373: two source-text grep "tests" were removed from this suite:
//   - "boot.js has error handling for app module import" — asserted the
//     literal substrings `catch` and `import(` appeared in docs/boot.js.
//   - "Boot scripts do not tell PWA users to clear browser cache" — asserted
//     the substring `pwa_recovery.js` appeared, and `please clear your
//     browser cache` did not, in each boot script's source text.
// Both inspected raw source rather than behaviour: they broke on any
// behaviour-preserving rewrite (wrapping the import in `.catch()`, aliasing
// the recovery import, rewording the message) and could go green for the
// wrong reason. The behaviour they gestured at is verified observably
// elsewhere:
//   - The recovery path (clear caches, unregister the SW, reload, and the
//     loop guard) is exercised end-to-end against the real helper in
//     tests/pwa_recovery_test.ts.
//   - Offline reachability of the recovery helper is asserted structurally by
//     the "SW STATIC_FILES caches pwa_recovery.js" case below.

Deno.test("SW STATIC_FILES caches pwa_recovery.js (Issue #194)", async () => {
  const swSource = await Deno.readTextFile(repoPath("docs", "sw.js"));
  const staticFiles = parseStaticFiles(swSource);
  assert(
    staticFiles.includes("./shared/pwa_recovery.js"),
    "sw.js STATIC_FILES must include ./shared/pwa_recovery.js so the recovery helper is reachable offline",
  );
});

// Issue #373: rewritten from a source-text grep (`/id="status"[^>]*>Loading/`
// over the raw HTML) into a DOM query. Parsing into a real document and
// reading the element's rendered text content pins the test to the
// user-observable contract — a visible loading status before JavaScript runs
// — instead of the exact source markup, so it tolerates attribute reordering
// and whitespace changes while still catching a genuinely empty status.
for (
  const page of [
    { label: "index.html", parts: ["docs", "index.html"] },
    { label: "graph/index.html", parts: ["docs", "graph", "index.html"] },
  ]
) {
  Deno.test(
    `${page.label} renders a visible loading status before JS runs (Issue #126)`,
    async () => {
      const doc = await loadDocument(repoPath(...page.parts));
      const status = doc.getElementById("status");
      assert(
        status,
        `${page.label} must have a #status element so users see state before JS runs`,
      );
      assert(
        /loading/i.test(status.textContent ?? ""),
        `${page.label} #status should show visible 'Loading…' text before JS runs, got: ${
          JSON.stringify(status.textContent)
        }`,
      );
    },
  );
}
