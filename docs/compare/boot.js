// Boot script for the candidate comparison page (docs/compare/index.html).
//
// Extracted from an inline <script type="module"> so the page can declare a
// strict Content-Security-Policy with `script-src 'self'` (no 'unsafe-inline'),
// mirroring the DAG/Sankey/subgraph boot pattern (Issue #218).
//
// This page renders no snapshot itself — it only wires links and iframes — so
// it does not need the Service Worker before its module loads. It still
// registers the SW so the app shell stays installable and offline-capable.
(async () => {
  const params = new URLSearchParams(location.search);
  const noSw = params.get("noSw") === "1";

  if (!noSw && "serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("../sw.js?v=__BUILD_ID__");
    } catch (err) {
      console.warn("SW registration failed:", err);
    }
  }

  // On local servers `__BUILD_ID__` is not replaced, so fall back to a
  // time-based cache buster for reliable local iteration.
  const buildId = "__BUILD_ID__";
  const v = buildId.includes("__BUILD_ID__") ? String(Date.now()) : buildId;
  try {
    await import(`./compare.js?v=${v}`);
  } catch (err) {
    console.error("Compare module failed to load:", err);
    const statusEl = document.getElementById("status");
    if (statusEl) {
      statusEl.textContent =
        "Failed to load the comparison page. Reload to retry.";
      statusEl.className = "status bad";
    }
  }
})();
