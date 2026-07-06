## Summary

Removed the dead-code export pair `ZOOM_MIN_DISTANCE` and `ZOOM_MAX_DISTANCE`
from `docs/shared/touch_gestures.js`. These constants were orphaned when their
only consumer, the `clampZoomDistance` helper, was removed (finding #400). An
identifier grep across every `.js`/`.ts`/`.html`/`.css`/`.json` module
(excluding `docs/vendor/`) confirmed the pair was referenced only by their own
unit test — no production module imports them, there is no barrel re-export, and
the live pinch-zoom path in `docs/graph/graph.js` clamps nothing against these
bounds (it uses `touchDistance` and `pinchZoomToward`). Confirmed no
dynamic/reflective use and no intended re-wiring before removing.

The matching import and the sole `ZOOM_MIN_DISTANCE < ZOOM_MAX_DISTANCE`
ordering assertion were removed from `tests/touch_gestures_test.ts`, along with
the two entries in the "all constants are positive numbers" loop.

Closes #434.

## Evidence

Purely a source cleanup with no web interface to screenshot. Verified by the
full quality gate `./quality.sh` — all 756 tests pass, `deno lint`/`deno fmt`
clean:

```
ok | 756 passed | 0 failed (4s)
==> OK
```

Grep after removal shows zero remaining references to either constant outside
`docs/vendor/`.

## Test Plan

- Removed
  `tests/touch_gestures_test.ts::"ZOOM_MIN_DISTANCE < ZOOM_MAX_DISTANCE"` and
  the two constant entries from the positive-numbers loop, since the constants
  they exercised no longer exist. This is a deliberate test change driven by the
  removal of the tested exports, not a workaround for a failure.
- All remaining touch-gesture tests (classifyTouch, detectSwipeDirection,
  momentumStep, clampMomentum, pinchZoomToward) continue to pass.
