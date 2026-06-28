## Summary

Removed the unused export `clampZoomDistance` from
`docs/shared/touch_gestures.js`. Module-graph analysis confirmed the function
was referenced only by its own unit tests — no application code in `docs/**`
(including `docs/graph/graph.js`) imported or called it, and it was not
re-exported from any barrel. Removing it is local to the module and its test
file. Closes #400.

The related `ZOOM_MIN_DISTANCE` / `ZOOM_MAX_DISTANCE` constants are kept: they
are a separate public export with their own positivity and ordering tests
(`all constants are positive numbers`, `ZOOM_MIN_DISTANCE < ZOOM_MAX_DISTANCE`),
so they remain in active use by the suite and are out of scope for this
dead-code removal.

## Evidence

Backend/pure-module change with no web interface to screenshot. Verified via the
Deno test suite — `./quality.sh` (format, lint, test) passes cleanly:

```
ok | 738 passed | 0 failed (16s)
==> OK
```

A whole-repo search confirmed `clampZoomDistance` no longer appears in any
source or test file after removal.

## Test Plan

- Removed the four `clampZoomDistance: …` test cases from
  `tests/touch_gestures_test.ts` (the symbol's only call sites) and dropped it
  from the import list.
- Ran `./quality.sh < /dev/null` — all 738 tests pass, lint and format clean.
  The remaining `touch_gestures` tests (constants, `classifyTouch`,
  `detectSwipeDirection`, `momentumStep`, `clampMomentum`, `pinchZoomToward`)
  continue to pass unchanged.
