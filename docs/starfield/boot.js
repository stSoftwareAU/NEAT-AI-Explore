// Boot script for the Starfield explorer (docs/starfield/index.html).
//
// Extracted from an inline <script type="module"> block in Issue #218 so that
// the page's Content-Security-Policy can declare `script-src 'self'` (no
// 'unsafe-inline'). Behaviour is unchanged from the previous inline version.
//
// Register the Service Worker *before* importing the graph explorer module.
//
// The graph explorer auto-loads the default snapshot on boot, and some
// environments (notably iOS/PWA) can fail the first fetch until the
// Service Worker has installed/activated. By awaiting SW readiness here,
// we avoid a first-load failure that succeeds on manual retry.
//
// Note: `navigator.serviceWorker.ready` never rejects and can remain
// pending forever if installation/activation fails. Use a timeout so the
// app still boots in degraded mode.
(async () => {
  // Local/dev escape hatch: allow disabling the Service Worker so you can
  // debug without navigation routing/caching surprises.
  // Usage: append `?noSw=1` to the URL.
  const params = new URLSearchParams(location.search);
  const noSw = params.get("noSw") === "1";

  if (!noSw && "serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register(
        "../sw.js?v=__BUILD_ID__",
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
  // On local servers, `__BUILD_ID__` is not replaced, so `starfield.js?v=__BUILD_ID__`
  // can get cached aggressively by browsers. When we detect the placeholder,
  // fall back to a time-based cache buster so local iteration is reliable.
  const buildId = "__BUILD_ID__";
  const v = buildId.includes("__BUILD_ID__") ? String(Date.now()) : buildId;
  try {
    await import(`./starfield.js?v=${v}`);
  } catch (err) {
    // Issue #194: PWA self-heal — clear caches, unregister SW, reload.
    console.error("Starfield module failed to load:", err);
    const statusEl = document.getElementById("status");
    if (statusEl) {
      statusEl.textContent = "Recovering — refreshing PWA caches…";
      statusEl.className = "statusInline";
    }
    try {
      const { recoverFromFailedAppLoad } = await import(
        `../shared/pwa_recovery.js?v=${v}`
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
