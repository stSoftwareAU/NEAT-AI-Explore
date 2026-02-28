## Summary

Three performance improvements for large snapshots. Closes #130.

1. **Debounced synapse filter**: The `synapseMinAlloc` input now uses a 150ms
   debounce, so `renderSynapseList` only fires after the user pauses typing —
   avoiding expensive DOM rebuilds on every keystroke for creatures with
   hundreds of synapses.

2. **Lazy correlation computation**: `computeTopInputCorrelations` is no longer
   called eagerly during `loadSnapshot`. Instead, it runs on the first
   Observations modal open and is cached for subsequent opens. This reduces
   initial snapshot load time, especially for creatures with many inputs (up to
   80×80 = 3,160 pairs).

3. **Graph view: skip label updates when nothing changed**: The animation loop
   now tracks the previous camera pose (yaw, pitch, position) and focus UUID.
   `updateLabelsForFocus` is only called when something actually changed,
   avoiding unnecessary DOM work every frame.

## Evidence

These are non-visual performance improvements. No UI changes to screenshot.
Verified by running `./quality.sh` — all 342 tests pass.

## Test Plan

- Added `tests/debounce_test.ts` with 5 tests covering:
  - Delayed invocation after quiet period
  - Timer reset on rapid calls
  - Argument forwarding
  - `cancel()` method
  - Return type validation
- Existing correlation and graph tests continue to pass unchanged
- `./quality.sh` passes cleanly (format, lint, 342 tests)
