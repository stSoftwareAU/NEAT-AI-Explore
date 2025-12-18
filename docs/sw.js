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

const STATIC_FILES = [
  "./index.html",
  `./styles.css?v=${VERSION}`,
  `./app.js?v=${VERSION}`,
  "./impact_attribution.js",
  "./impact_diagnostics.js",
  "./Tooltips.json",
  "./manifest.webmanifest",
  "./icons/icon-72x72.png",
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
            if (key !== STATIC_CACHE && key !== RUNTIME_CACHE) {
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

function isJsonRequest(request) {
  const url = new URL(request.url);
  return url.pathname.endsWith(".json") ||
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
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const res = await fetch(request, { cache: "no-store" });
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw new Error("Offline and no cached response available");
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  if (!request.url.startsWith("http")) return;
  if (!isSameOrigin(request.url)) return;

  // Navigation -> cached index.html as app shell.
  if (request.mode === "navigate") {
    event.respondWith(cacheFirst("./index.html"));
    return;
  }

  // JSON snapshots -> try network first, then cache.
  if (isJsonRequest(request)) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Everything else (css/js/images/manifest) -> cache first.
  event.respondWith(cacheFirst(request));
});
