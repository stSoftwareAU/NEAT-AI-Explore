// Boot script for the layered DAG view (docs/dag/index.html) — Issue #525.
//
// Mirrors docs/graph/boot.js: the Service Worker is registered *before* the
// view module is imported so the first snapshot fetch does not race SW
// activation, and a failed module import self-heals the PWA caches (Issue
// #194) instead of leaving the page stuck on "Loading…".
(async () => {
  // Local/dev escape hatch: `?noSw=1` disables the Service Worker.
  const params = new URLSearchParams(location.search);
  const noSw = params.get("noSw") === "1";

  if (!noSw && "serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("../sw.js?v=__BUILD_ID__");
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      // `navigator.serviceWorker.ready` never rejects and can stay pending
      // forever, so cap the wait and boot in degraded mode instead.
      await Promise.race([navigator.serviceWorker.ready, sleep(2000)]);
    } catch (err) {
      console.warn("SW registration failed:", err);
    }
  }

  // On local servers `__BUILD_ID__` is not substituted, so fall back to a
  // time-based cache buster to keep local iteration reliable.
  const buildId = "__BUILD_ID__";
  const v = buildId.includes("__BUILD_ID__") ? String(Date.now()) : buildId;
  try {
    await import(`./dag.js?v=${v}`);
  } catch (err) {
    console.error("DAG module failed to load:", err);
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
