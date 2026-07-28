/**
 * NEAT-AI Explore - Service Worker
 *
 * Cache strategy:
 * - App shell (HTML/CSS/JS/icons/manifest): cache-first
 * - JSON snapshots: network-first with cache fallback (handy when re-opening)
 *
 * Note: This PWA is a viewer/debug tool. Offline support is best-effort.
 *
 * Version: __BUILD_ID__
 */

const VERSION = "__BUILD_ID__";
const STATIC_CACHE = `neat-ai-explore-static-v${VERSION}`;
const RUNTIME_CACHE = `neat-ai-explore-runtime-v${VERSION}`;
// Snapshot cache is unversioned so it survives SW updates (Issue #52).
// The app's fetchJson() caches snapshots here, and they should remain
// available after a version update to prevent first-fetch failures.
const SNAPSHOT_CACHE = "neat-ai-explore-snapshots";

const STATIC_FILES = [
  "./index.html",
  `./styles.css?v=${VERSION}`,
  `./app.js?v=${VERSION}`,
  // Boot script extracted from inline <script> in Issue #218 so the entry HTML
  // can declare `script-src 'self'` without 'unsafe-inline'. Must be precached
  // alongside the HTML so the PWA still boots offline.
  `./boot.js?v=${VERSION}`,
  "./impact_attribution.js",
  "./impact_diagnostics.js",
  "./vendor/fflate.browser.js",
  "./manifest.webmanifest",
  "./favicon.ico",
  // Graph view (Issue #25): kept in its own folder to avoid destabilising the
  // existing explorer view.
  "./graph/index.html",
  `./graph/graph.js?v=${VERSION}`,
  `./graph/graph.css?v=${VERSION}`,
  `./graph/boot.js?v=${VERSION}`,
  // Layered DAG view (Issue #525): cached so the DAG view works offline.
  "./dag/index.html",
  `./dag/dag.js?v=${VERSION}`,
  `./dag/dag.css?v=${VERSION}`,
  `./dag/boot.js?v=${VERSION}`,
  // Top-impact subgraph view (Issue #527): cached so the subgraph view works
  // offline.
  "./subgraph/index.html",
  `./subgraph/subgraph.js?v=${VERSION}`,
  `./subgraph/subgraph.css?v=${VERSION}`,
  `./subgraph/boot.js?v=${VERSION}`,
  // Off-main-thread derivation worker (Issue #560): precached so the subgraph
  // page derives off the main thread offline too.
  `./subgraph/subgraph_worker.js?v=${VERSION}`,
  // Starfield view (Issue #129): cached so starfield works offline.
  "./starfield/index.html",
  `./starfield/starfield.js?v=${VERSION}`,
  `./starfield/starfield.css?v=${VERSION}`,
  `./starfield/boot.js?v=${VERSION}`,
  // Candidate comparison view (Issue #522): cached so compare works offline.
  "./compare/index.html",
  `./compare/compare.js?v=${VERSION}`,
  `./compare/compare.css?v=${VERSION}`,
  `./compare/boot.js?v=${VERSION}`,
  // Sankey flow view (Issue #522): cached so sankey works offline.
  "./sankey/index.html",
  `./sankey/sankey.js?v=${VERSION}`,
  `./sankey/sankey.css?v=${VERSION}`,
  `./sankey/boot.js?v=${VERSION}`,
  `./sankey/fold_panel.js?v=${VERSION}`,
  `./sankey/tooltip_panel.js?v=${VERSION}`,
  `./sankey/zoom_pan.js?v=${VERSION}`,
  // Shared modules for multiple views (Issue #126: all shared modules must be
  // listed so they are precached and invalidated with each deploy — missing
  // modules can be served stale by cacheFirst, breaking imports).
  "./shared/config.js",
  "./shared/snapshot_loader.js",
  "./shared/graph_analysis.js",
  "./shared/creature_overview.js",
  "./shared/transitions.js",
  "./shared/sparkline.js",
  "./shared/touch_gestures.js",
  "./shared/keyboard_nav.js",
  "./shared/theme.js",
  "./shared/trace_score.js",
  "./shared/colour_maps.js",
  "./shared/correlation.js",
  "./shared/debounce.js",
  "./shared/discovery.js",
  "./shared/diagnostics_scan.js",
  "./shared/ui_helpers.js",
  // Issue #521: the module is precached, but ./tooltips.json (~430 KB) is not
  // — it is fetched on demand only for snapshots that lack embedded tooltips.
  "./shared/tooltips_fallback.js",
  "./shared/modal_focus.js",
  "./shared/responsive.js",
  "./shared/filter_layout.js",
  "./shared/trace_header.js",
  "./shared/trace_overflow_menu.js",
  "./shared/observation_contributions.js",
  "./shared/observation_contributions_storage.js",
  "./shared/panel_resize.js",
  "./shared/synapse_render.js",
  "./shared/consumer_contract.js",
  "./shared/gate_chip.js",
  "./shared/pwa_recovery.js",
  "./shared/number_format.js",
  "./shared/scale.js",
  "./shared/topology_diagram.js",
  "./shared/topo_modal.js",
  "./shared/aggregated_graph_model.js",
  "./shared/observation_families.js",
  "./shared/dag_layout.js",
  "./shared/subgraph_model.js",
  // Off-main-thread subgraph derivation (Issue #560).
  "./shared/subgraph_derivation.js",
  "./shared/subgraph_worker_client.js",
  // On-device derived-subgraph cache (Issue #561).
  "./shared/subgraph_cache.js",
  "./shared/candidate_views.js",
  "./shared/sankey_flow.js",
  "./shared/sankey_layout.js",
  "./shared/sankey_responsive.js",
  "./shared/viewbox_zoom.js",
  "./icons/icon-72x72.png",
  "./icons/icon-16x16.png",
  "./icons/icon-32x32.png",
  "./icons/icon-96x96.png",
  "./icons/icon-128x128.png",
  "./icons/icon-144x144.png",
  "./icons/icon-152x152.png",
  "./icons/icon-192x192.png",
  "./icons/icon-384x384.png",
  "./icons/icon-512x512.png",
];

// Directories under docs/ that serve their own index.html app shell. Every new
// entry page must be listed here (navigation routing) and in STATIC_FILES
// (precache), and added to scripts/inject_build_id.ts — Issue #549.
// tests/entry_page_pwa_wiring_test.ts fails locally and in CI when a page is
// missing from any of the three.
const ENTRY_PAGE_DIRS = [
  "graph",
  "starfield",
  "dag",
  "subgraph",
  "compare",
  "sankey",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);

      // Cache files individually so a single missing/redirected asset does not
      // break service worker installation (Cache.addAll is all-or-nothing).
      const results = await Promise.allSettled(
        STATIC_FILES.map((path) =>
          cache.add(new Request(path, { cache: "reload" }))
        ),
      );

      const failed = results
        .map((r, i) => ({ r, i }))
        .filter(({ r }) => r.status === "rejected")
        .map(({ i }) => STATIC_FILES[i]);

      if (failed.length > 0) {
        // Non-fatal: the app will still run, and runtime caching can fill gaps.
        console.warn(
          "Service Worker: Some static files failed to cache:",
          failed,
        );
      }

      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            // Preserve current versioned caches and the unversioned snapshot
            // cache. The snapshot cache survives version updates so users
            // don't lose cached snapshots on first load (Issue #52).
            if (
              key !== STATIC_CACHE &&
              key !== RUNTIME_CACHE &&
              key !== SNAPSHOT_CACHE
            ) {
              return caches.delete(key);
            }
          }),
        )
      )
      .then(() => self.clients.claim()),
  );
});

function isSameOrigin(url) {
  try {
    return new URL(url).origin === self.location.origin;
  } catch {
    return false;
  }
}

// Canonical origin list: shared/config.js ALLOWED_SNAPSHOT_ORIGINS (Issue #125).
// Service workers cannot use ES module imports, so keep a local copy here.
const ALLOWED_SNAPSHOT_ORIGINS = [
  "https://stsoftwareau.github.io",
  "https://raw.githubusercontent.com",
];

function isAllowedSnapshotOrigin(url) {
  // We allow cross-origin snapshot caching for the official Snapshot hosts so
  // the app can work offline while keeping the rest of the cache same-origin.
  try {
    const origin = new URL(url).origin;
    if (origin === self.location.origin) return true;
    if (ALLOWED_SNAPSHOT_ORIGINS.includes(origin)) return true;
  } catch {
    // Fall through.
  }
  return false;
}

function isJsonRequest(request) {
  const url = new URL(request.url);
  return url.pathname.endsWith(".json") ||
    url.pathname.endsWith(".json.gz") ||
    request.headers.get("accept")?.includes("application/json");
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  const cache = await caches.open(RUNTIME_CACHE);
  cache.put(request, res.clone());
  return res;
}

async function networkFirst(request) {
  // Use the unversioned SNAPSHOT_CACHE for JSON snapshots so cached data
  // survives SW version updates (Issue #52).
  const cache = await caches.open(SNAPSHOT_CACHE);
  try {
    // Use revalidation semantics so fresh snapshots are used when possible, but
    // cached snapshots remain available offline.
    const res = await fetch(request, { cache: "no-cache" });
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    // Check both the snapshot cache and the global cache for fallback.
    const cached = await caches.match(request);
    if (cached) return cached;
    throw new Error("Offline and no cached response available");
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  if (!request.url.startsWith("http")) return;
  const sameOrigin = isSameOrigin(request.url);
  const allowedSnapshotOrigin = isAllowedSnapshotOrigin(request.url);

  // Only handle:
  // - same-origin navigation/static assets
  // - allowed snapshot origins for .json/.json.gz requests
  if (!sameOrigin && !(allowedSnapshotOrigin && isJsonRequest(request))) return;

  // Navigation -> cached index.html as app shell.
  if (request.mode === "navigate") {
    if (!sameOrigin) return;
    // This site has multiple entry points under docs/ — the root Explorer
    // plus one directory per view (see ENTRY_PAGE_DIRS).
    //
    // IMPORTANT: If we always serve "./index.html" for navigation, then visiting
    // "/graph/" will load the explorer HTML, and its relative asset URLs
    // (./styles.css, ./app.js) will resolve under "/graph/" and 404.
    // That produces a blank/unstyled page.
    const path = (() => {
      try {
        return new URL(request.url).pathname;
      } catch {
        return "";
      }
    })();
    // Data-driven so adding a page is a one-line change (Issue #549): a page
    // missing here is served the root Explorer shell instead of its own.
    const dir = path.split("/").find((segment) =>
      ENTRY_PAGE_DIRS.includes(segment)
    );
    const shell = dir ? `./${dir}/index.html` : "./index.html";
    event.respondWith(cacheFirst(shell));
    return;
  }

  // JSON snapshots -> try network first, then cache.
  if (isJsonRequest(request)) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Everything else (css/js/images/manifest) -> cache first.
  if (!sameOrigin) return;
  event.respondWith(cacheFirst(request));
});
