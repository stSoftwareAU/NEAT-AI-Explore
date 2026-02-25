## Summary

Fixed silent loading failures where the app showed no UI indication of errors
when loading failed. The root causes were:

1. **Unhandled dynamic `import()` rejection**: The bootstrap script in
   `index.html` had no error handling on the `await import('./app.js')` call.
   If the module failed to load (stale SW cache, network error, JS error during
   module evaluation), users saw a blank page with no feedback.

2. **Missing `.catch()` on fire-and-forget promises**: `autoLoadWithRetry()`
   and the manual fetch button handler called async functions without catching
   rejections, causing unhandled promise rejections.

3. **Incomplete Service Worker pre-cache**: Five shared modules imported by
   `app.js` were missing from the SW's `STATIC_FILES` list, making offline
   loading fragile after deploys.

Fixes applied:

- **`index.html`**: Added `try/catch` around the dynamic import with a visible
  error message. Added global `error` and `unhandledrejection` listeners before
  the module script to catch early failures. Added `"Initialising…"` default
  text in the status span for immediate pre-JS feedback. Added `<noscript>`
  fallback. On import failure, automatically clears stale SW caches for
  self-healing on next reload.

- **`app.js`**: Added `.catch()` handlers on `autoLoadWithRetry()` calls and
  the manual fetch button handler. Added `data-appLoaded` flag so global error
  handlers yield to app-level status once the module has loaded.

- **`sw.js`**: Added five missing shared modules to `STATIC_FILES`
  (`config.js`, `graph_analysis.js`, `creature_overview.js`, `transitions.js`,
  `sparkline.js`) so the app works offline after a single online visit.

Closes #126.

## Evidence

This is a loading/error-handling fix — the visual change is the addition of a
pre-JS "Initialising…" status message and proper error messages on failure. The
fix was verified by:

- Confirmed all 233 tests pass (including 4 new loading robustness tests)
- Quality gate (`./quality.sh`) passes cleanly
- End-to-end loading test with the live snapshot (67 MB uncompressed) completes
  successfully with correct computation results

## Test Plan

- Added `tests/loading_robustness_test.ts` with 4 tests:
  - SW `STATIC_FILES` includes all modules imported by `app.js`
  - `index.html` has error handling on dynamic import
  - `index.html` shows a pre-JS loading indicator
  - `index.html` has a global error handler for unhandled errors
