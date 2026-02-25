## Summary

When the app auto-loads a snapshot on page open, the first attempt can fail due
to Service Worker activation timing or transient network issues. Previously the
user had to manually click "Fetch" to retry. Now both the trace explorer and
graph explorer automatically retry the entire load sequence (including fallback
URLs) with exponential backoff, matching what a manual "Fetch" click would do.
Closes #118.

### What changed

- **`docs/shared/config.js`**: Added `AUTO_LOAD_MAX_RETRIES` (2) and
  `AUTO_LOAD_RETRY_DELAY_MS` (2000ms) as shared constants.
- **`docs/app.js`**: Wrapped the init auto-load call in `autoLoadWithRetry()`
  which checks whether `SNAPSHOT` was populated and retries with exponential
  backoff if not.
- **`docs/graph/graph.js`**: Same `autoLoadWithRetry()` wrapper for the graph
  explorer init.
- **`tests/config_test.ts`**: Added tests for the two new config constants.

### Retry strategy (three layers)

| Layer | Scope | Retries | Delay |
|-------|-------|---------|-------|
| `snapshot_loader.js` `fetchSnapshotJson` | Single URL fetch | 2 | 500ms × 2^n |
| `app.js` / `graph.js` `fetchJson` | Fetch + fallback URLs + cache | 2 | 500ms × 2^n |
| **New:** `autoLoadWithRetry` (this PR) | Entire load sequence | 2 | 2000ms × 2^n |

## Evidence

![Auto-loaded snapshot](docs/evidence/auto-load-retry.png)

## Test Plan

- Added `AUTO_LOAD_MAX_RETRIES is a positive integer` test
- Added `AUTO_LOAD_RETRY_DELAY_MS is a positive number` test
- All 225 tests pass via `./quality.sh`
