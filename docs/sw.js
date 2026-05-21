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
  // Starfield view (Issue #129): cached so starfield works offline.
  "./starfield/index.html",
  `./starfield/starfield.js?v=${VERSION}`,
  `./starfield/starfield.css?v=${VERSION}`,
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
  "./shared/theme.js",
  "./shared/trace_score.js",
  "./shared/colour_maps.js",
  "./shared/correlation.js",
  "./shared/debounce.js",
  "./shared/discovery.js",
  "./shared/diagnostics_scan.js",
  "./shared/ui_helpers.js",
  "./shared/modal_focus.js",
  "./shared/trace_header.js",
  "./shared/observation_contributions.js",
  "./shared/synapse_render.js",
  "./shared/pwa_recovery.js",
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
    // This site has multiple entry points under docs/:
    // - ./index.html (Explorer)
    // - ./graph/index.html (Graph)
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
    const isGraphNav = /\/graph(\/|$)/.test(path);
    const isStarfieldNav = /\/starfield(\/|$)/.test(path);
    const shell = isGraphNav
      ? "./graph/index.html"
      : isStarfieldNav
      ? "./starfield/index.html"
      : "./index.html";
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
