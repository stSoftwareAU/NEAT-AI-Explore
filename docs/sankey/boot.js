// Boot script for the Sankey contribution-flow view (docs/sankey/index.html).
//
// Extracted from an inline <script type="module"> so the page can declare a
// strict Content-Security-Policy with `script-src 'self'` (no 'unsafe-inline'),
// mirroring the starfield/graph boot pattern (Issue #218).
//
// Register the Service Worker before importing the view module so the first
// snapshot fetch does not race Service Worker activation on iOS/PWA. SW
// readiness is bounded by a timeout because `navigator.serviceWorker.ready`
// never rejects and can hang forever if activation fails.
(async () => {
  const params = new URLSearchParams(location.search);
  const noSw = params.get("noSw") === "1";

  if (!noSw && "serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("../sw.js?v=__BUILD_ID__");
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      await Promise.race([navigator.serviceWorker.ready, sleep(2000)]);
    } catch (err) {
      console.warn("SW registration failed:", err);
    }
  }

  // On local servers `__BUILD_ID__` is not replaced, so fall back to a
  // time-based cache buster for reliable local iteration.
  const buildId = "__BUILD_ID__";
  const v = buildId.includes("__BUILD_ID__") ? String(Date.now()) : buildId;
  try {
    await import(`./sankey.js?v=${v}`);
  } catch (err) {
    console.error("Sankey module failed to load:", err);
    const statusEl = document.getElementById("status");
    if (statusEl) {
      statusEl.textContent = "Recovering — refreshing PWA caches…";
      statusEl.className = "status";
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
          "Failed to load the Sankey view. Remove the app and reinstall.";
        statusEl.className = "status bad";
      }
    } catch (recoveryErr) {
      console.error("PWA recovery failed:", recoveryErr);
      if (statusEl) {
        statusEl.textContent =
          "Failed to load the Sankey view. Remove the app and reinstall.";
        statusEl.className = "status bad";
      }
    }
  }
})();
