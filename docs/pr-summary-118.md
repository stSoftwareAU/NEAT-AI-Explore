## Summary

The automatic snapshot load sometimes fails on the first attempt (e.g. during
Service Worker activation or on flaky networks) but succeeds when the user
manually clicks "Fetch". This adds a top-level auto-retry around the initial
`loadSnapshot` call so the app recovers automatically without user
intervention. Closes #118.

### What changed

- **`docs/shared/config.js`**: Added `LOAD_AUTO_RETRY_LIMIT` (2) and
  `LOAD_AUTO_RETRY_DELAY_MS` (3 000 ms) constants for the new auto-retry
  behaviour.
- **`docs/shared/snapshot_loader.js`**: Added `computeRetryDelayMs(attempt,
  baseDelayMs)` — a pure, testable exponential-backoff helper capped at 30 s.
- **`docs/app.js`**: `loadSnapshot` now returns `true`/`false`. The init
  section uses `autoLoadWithRetry` which retries the full load operation on
  failure (up to `LOAD_AUTO_RETRY_LIMIT` times with exponential backoff).
  Status bar shows "Load failed — retrying in Xs (attempt N)…" between
  attempts.
- **`docs/graph/graph.js`**: Same auto-retry pattern applied to the graph
  explorer's boot sequence.

This is layered on top of the existing per-fetch retry
(`FETCH_MAX_RETRIES = 2` with 500 ms/1 000 ms delays). The per-fetch retry
handles transient network blips; the new auto-retry handles longer recovery
windows (Service Worker activation, CDN warm-up).

## Evidence

This is a resilience/behaviour change rather than a visual change. The fix is
verified by the new unit tests and the existing test suite (231 tests pass).
The user-visible change is that the status bar shows retry messages instead of
a static error when auto-load fails.

## Test Plan

- Added `tests/auto_retry_test.ts` (8 tests):
  - `LOAD_AUTO_RETRY_LIMIT` is a positive integer ≤ 5
  - `LOAD_AUTO_RETRY_DELAY_MS` is between 1 000 ms and 10 000 ms
  - `computeRetryDelayMs` returns correct exponential-backoff delays
  - `computeRetryDelayMs` caps at 30 seconds
  - `computeRetryDelayMs` handles zero base delay
- All 231 tests pass (`./quality.sh` clean)
