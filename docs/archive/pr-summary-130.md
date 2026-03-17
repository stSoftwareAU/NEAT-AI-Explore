## Summary

Three performance improvements for large snapshots. Closes #130.

1. **Debounced synapse filter** — the `synapseMinAlloc` input now uses a 150ms
   debounce so `renderSynapseList` only fires after the user pauses typing,
   avoiding expensive DOM rebuilds on every keystroke.

2. **Lazy correlation computation** — `computeTopInputCorrelations` is no longer
   called eagerly during `loadSnapshot`. Instead it runs on first render of the
   diagnostics panel and caches the result, reducing initial load time for
   creatures with many inputs.

3. **Graph label dirty flag** — the animation loop in `graph.js` now tracks the
   camera pose (`yaw`, `pitch`, `pos`) and focus UUID, skipping
   `updateLabelsForFocus` entirely when nothing has changed.

A shared `createDebounce` utility was added to `docs/shared/debounce.js` with
full test coverage (5 tests).

## Evidence

![Trace explorer with debounced synapse filter](docs/evidence/trace-explorer-synapse-filter.png)

![Graph explorer with label dirty flag](docs/evidence/graph-explorer-labels.png)

## Test Plan

- Added `tests/debounce_test.ts` (5 tests) covering:
  - Delayed invocation after timeout
  - Timer reset on rapid calls
  - Argument forwarding
  - Cancel prevents pending invocation
  - Re-call after cancel works
- All 342 existing tests continue to pass
- `./quality.sh` passes cleanly (format, lint, test)
