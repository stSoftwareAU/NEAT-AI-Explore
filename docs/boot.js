// Boot script for the Trace explorer (docs/index.html).
//
// Extracted from an inline <script type="module"> block in Issue #218 so that
// the page's Content-Security-Policy can declare `script-src 'self'` (no
// 'unsafe-inline'). Behaviour is unchanged from the previous inline version.
//
// Register the Service Worker *before* importing the app module.
//
// Issue #22 (28-Dec-2025): the app auto-loads the default snapshot on
// startup, and some environments (notably iOS/PWA) can fail the first
// fetch until the Service Worker has installed/activated. By awaiting
// SW readiness here, we avoid a first-load failure that succeeds on
// manual retry.
//
// Issue #23 (29-Dec-2025): `navigator.serviceWorker.ready` never rejects
// and can remain pending forever if installation/activation fails (e.g.
// quota exceeded, privacy mode restrictions, or an unhandled SW install
// error). Use a timeout so the app still boots in degraded mode.
(async () => {
  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register(
        "./sw.js?v=__BUILD_ID__",
      );
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      await Promise.race([
        navigator.serviceWorker.ready,
        sleep(2000),
      ]);
    } catch (err) {
      console.warn("SW registration failed:", err);
    }
  }

  // Start the app once SW registration has had a chance to settle.
  //
  // Dev ergonomics:
  // On local servers, `__BUILD_ID__` is not replaced, so `app.js?v=__BUILD_ID__`
  // can get cached aggressively by browsers. When we detect the placeholder,
  // fall back to a time-based cache buster so local iteration is reliable.
  const buildId = "__BUILD_ID__";
  const v = buildId.includes("__BUILD_ID__") ? String(Date.now()) : buildId;
  try {
    await import(`./app.js?v=${v}`);
  } catch (err) {
    // Issue #126: If the module fails to import (e.g., stale cached
    // dependency missing an expected export), show a visible error
    // instead of failing silently with no UI indication.
    //
    // Issue #194: For a PWA — especially on iOS — telling the user to
    // "clear your browser cache" is a dead end (there is no obvious
    // cache to clear). Attempt automatic recovery instead: clear all
    // caches, unregister the SW, and reload. A session flag inside the
    // helper prevents an infinite recovery loop.
    console.error("App module failed to load:", err);
    const statusEl = document.getElementById("status");
    if (statusEl) {
      statusEl.textContent = "Recovering — refreshing PWA caches…";
      statusEl.className = "statusInline";
    }
    try {
      const { recoverFromFailedAppLoad } = await import(
        `./shared/pwa_recovery.js?v=${v}`
      );
      const result = await recoverFromFailedAppLoad({
        storage: globalThis.sessionStorage,
        cachesApi: globalThis.caches,
        swContainer: navigator.serviceWorker,
        reload: () => globalThis.location.reload(),
      });
      if (!result.recovered && statusEl) {
        statusEl.textContent =
          "Failed to load app. Tap and hold the icon, remove the app, then reinstall.";
        statusEl.className = "statusInline bad";
      }
    } catch (recoveryErr) {
      console.error("PWA recovery failed:", recoveryErr);
      if (statusEl) {
        statusEl.textContent =
          "Failed to load app. Tap and hold the icon, remove the app, then reinstall.";
        statusEl.className = "statusInline bad";
      }
    }
  }
})();
