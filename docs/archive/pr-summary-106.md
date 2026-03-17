## Summary

Improve mobile touch interactions in the graph explorer so it feels natural and
responsive on iPhone, iPad, and other touch devices. Closes #106.

### What changed

1. **Pinch-to-zoom toward midpoint** — Two-finger zoom now shifts the camera
   toward the pinch midpoint (not the canvas centre), using the new
   `pinchZoomToward()` helper from the shared module.

2. **Two-finger pan with momentum** — After lifting fingers from a pan gesture,
   the view continues scrolling with friction-based deceleration for a natural
   "flick" feel. Momentum is clamped to a safe maximum velocity and stops
   cleanly below a minimum threshold.

3. **Tap-to-focus with ripple** — Single taps are properly distinguished from
   drags using movement distance and duration thresholds. Tapping a neuron shows
   a brief expanding ripple animation and triggers the existing focus/zoom
   behaviour.

4. **Long-press for tooltip** — Holding a finger for 500 ms on a neuron shows
   the HUD detail panel without triggering text selection (CSS
   `-webkit-touch-callout: none` on `.stage`).

5. **Swipe navigation** — Horizontal swipe left/right cycles through neurons:
   swipe left advances to a neighbouring neuron, swipe right navigates back in
   the focus trail.

6. **Touch feedback** — Neuron labels scale up slightly on touch-start and
   return to normal on release. Buttons have a haptic-style press animation (CSS
   `transform: scale(0.93)` on `:active`).

7. **Desktop graceful degradation** — All mouse interactions (click, drag,
   wheel) continue to work unchanged. Synthetic click events from touch are
   suppressed to prevent double-triggering.

### Architecture

Extracted pure, DOM-free gesture logic into `docs/shared/touch_gestures.js`:

- `classifyTouch()` — tap vs drag vs long-press classification
- `detectSwipeDirection()` — horizontal swipe detection with thresholds
- `momentumStep()` / `clampMomentum()` — friction-based deceleration
- `pinchZoomToward()` — focal-point zoom offset calculation
- `clampZoomDistance()` — zoom bounds enforcement

All constants (thresholds, friction, durations) are exported and tested.

## Evidence

This is a UI change affecting touch interactions. The graph explorer renders
with WebGL which requires GPU context; the screenshot below shows the mobile
viewport layout. Touch interactions are validated through the pure gesture logic
unit tests (DOM/touch events cannot be simulated in Deno).

![Mobile graph explorer](docs/evidence/touch-interactions-mobile.png)

## Test plan

- Added 32 unit tests in `tests/touch_gestures_test.ts`:
  - `classifyTouch`: tap, drag, long-press classification (7 tests)
  - `detectSwipeDirection`: left/right/null swipe detection (6 tests)
  - `momentumStep`: friction deceleration and convergence (3 tests)
  - `clampMomentum`: velocity capping and direction preservation (4 tests)
  - `pinchZoomToward`: focal-point zoom offset (4 tests)
  - `clampZoomDistance`: zoom bounds (4 tests)
  - Constants validation (4 tests)
- Added `touch_gestures.js` to lint coverage test
- All 185 tests pass (`./quality.sh` clean)
