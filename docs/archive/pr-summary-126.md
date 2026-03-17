## Summary

Fix loading being completely broken — both auto-load and manual fetch showed no
UI indication of anything happening nor any errors. Closes #126.

### Root cause

The Service Worker's `STATIC_FILES` list was missing several shared modules
(`config.js`, `graph_analysis.js`, `creature_overview.js`, `transitions.js`,
`sparkline.js`, `touch_gestures.js`). When a new version was deployed, the SW's
`cacheFirst` strategy could serve stale cached versions of these modules. If a
stale module was missing a newly-added export (e.g., `AUTO_LOAD_MAX_RETRIES`
added in #118), the ES module import would fail silently — the bootstrap IIFE in
`index.html` had no error handling, so users saw a blank page with no loading
indicator and no error message.

### Fixes

1. **`docs/sw.js`**: Added all shared modules to `STATIC_FILES` so they are
   precached and invalidated with each deploy.
2. **`docs/index.html`** and **`docs/graph/index.html`**: Added `try-catch`
   around the dynamic `import()` call so module load failures show a visible
   error message ("Failed to load app — please clear your browser cache and
   reload.").
3. **`docs/index.html`** and **`docs/graph/index.html`**: Set initial status
   text to "Loading…" so users always see something before JavaScript executes.
4. **`docs/app.js`** and **`docs/graph/graph.js`**: Added `.catch()` to the
   `autoLoadWithRetry()` calls so errors are displayed in the status bar instead
   of being silently swallowed as unhandled promise rejections.

## Evidence

![Fix evidence](docs/evidence/loading-fix-evidence.png)

**Before**: The `#status` element started empty. If the app module failed to
import (stale cache), users saw nothing — no loading indicator, no error.

**After**: The `#status` element starts with "Loading…" text visible before JS
runs. If the module import fails, a clear error message is shown. All shared
modules are precached by the SW for proper cache invalidation.

Verified locally:

- `curl` confirms `id="status" class="statusInline">Loading…` is present in the
  served HTML before any JS executes.
- WebFetch on the deployed site confirms the page loads and renders correctly
  with no errors.

Note: Headless Chromium screenshots could not be generated (binary crash on this
platform). Test output and HTML verification are provided instead.

## Test Plan

- Added `tests/sw_static_files_test.ts` with 4 new tests:
  - SW STATIC_FILES includes all shared modules imported by `app.js`
  - SW STATIC_FILES includes all shared modules imported by `graph.js`
  - `index.html` has error handling for app module import
  - `index.html` shows initial loading status before JS runs
- All 233 tests pass (including 4 new ones).
- `quality.sh` passes cleanly (format + lint + test).
