/**
 * Tests for docs/shared/touch_gestures.js (#106).
 *
 * Validates pure gesture classification, momentum, swipe detection,
 * and pinch-to-zoom helpers.
 */

import { approx, assert, assertEquals } from "./test_helpers.ts";

import {
  clampMomentum,
  clampZoomDistance,
  classifyTouch,
  detectSwipeDirection,
  LONG_PRESS_MS,
  MOMENTUM_FRICTION,
  MOMENTUM_MAX_VELOCITY,
  MOMENTUM_MIN_VELOCITY,
  momentumStep,
  pinchZoomToward,
  RIPPLE_DURATION_MS,
  SWIPE_MAX_CROSS_PX,
  SWIPE_MAX_DURATION_MS,
  SWIPE_MIN_DISTANCE_PX,
  TAP_MAX_DURATION_MS,
  TAP_THRESHOLD_PX,
  TOUCH_SCALE_FACTOR,
  ZOOM_MAX_DISTANCE,
  ZOOM_MIN_DISTANCE,
} from "../docs/shared/touch_gestures.js";

// ── Constants ────────────────────────────────────────────────────────────────

Deno.test("all constants are positive numbers", () => {
  for (
    const val of [
      TAP_THRESHOLD_PX,
      TAP_MAX_DURATION_MS,
      LONG_PRESS_MS,
      MOMENTUM_FRICTION,
      MOMENTUM_MIN_VELOCITY,
      MOMENTUM_MAX_VELOCITY,
      SWIPE_MIN_DISTANCE_PX,
      SWIPE_MAX_CROSS_PX,
      SWIPE_MAX_DURATION_MS,
      ZOOM_MIN_DISTANCE,
      ZOOM_MAX_DISTANCE,
      TOUCH_SCALE_FACTOR,
      RIPPLE_DURATION_MS,
    ]
  ) {
    assertEquals(typeof val, "number");
    assert(val > 0, `Expected positive, got ${val}`);
  }
});

Deno.test("MOMENTUM_FRICTION is between 0 and 1", () => {
  assert(MOMENTUM_FRICTION > 0 && MOMENTUM_FRICTION < 1);
});

Deno.test("ZOOM_MIN_DISTANCE < ZOOM_MAX_DISTANCE", () => {
  assert(ZOOM_MIN_DISTANCE < ZOOM_MAX_DISTANCE);
});

Deno.test("TOUCH_SCALE_FACTOR is greater than 1", () => {
  assert(TOUCH_SCALE_FACTOR > 1);
});

// ── classifyTouch ────────────────────────────────────────────────────────────

Deno.test("classifyTouch: short stationary touch is a tap", () => {
  assertEquals(classifyTouch(0, 0, 100), "tap");
});

Deno.test("classifyTouch: small movement within threshold is still a tap", () => {
  assertEquals(classifyTouch(3, 4, 150), "tap"); // 5px < 10px threshold
});

Deno.test("classifyTouch: movement beyond threshold is a drag", () => {
  assertEquals(classifyTouch(8, 8, 100), "drag"); // ~11.3px > 10px
});

Deno.test("classifyTouch: long hold without movement is a longpress", () => {
  assertEquals(classifyTouch(0, 0, 600), "longpress");
});

Deno.test("classifyTouch: long hold at exactly LONG_PRESS_MS+1 is longpress", () => {
  assertEquals(classifyTouch(2, 2, LONG_PRESS_MS + 1), "longpress");
});

Deno.test("classifyTouch: movement overrides long duration", () => {
  // Even with a long hold, if the finger moved far enough it's a drag.
  assertEquals(classifyTouch(20, 0, 800), "drag");
});

Deno.test("classifyTouch: duration between tap and longpress is drag", () => {
  // Between TAP_MAX_DURATION_MS and LONG_PRESS_MS with no movement.
  const mid = (TAP_MAX_DURATION_MS + LONG_PRESS_MS) / 2;
  assertEquals(classifyTouch(0, 0, mid), "drag");
});

// ── detectSwipeDirection ─────────────────────────────────────────────────────

Deno.test("detectSwipeDirection: fast left swipe", () => {
  assertEquals(detectSwipeDirection(-80, 5, 200), "left");
});

Deno.test("detectSwipeDirection: fast right swipe", () => {
  assertEquals(detectSwipeDirection(90, -10, 250), "right");
});

Deno.test("detectSwipeDirection: too slow is null", () => {
  assertEquals(detectSwipeDirection(-100, 0, SWIPE_MAX_DURATION_MS + 50), null);
});

Deno.test("detectSwipeDirection: too short distance is null", () => {
  assertEquals(detectSwipeDirection(30, 0, 200), null);
});

Deno.test("detectSwipeDirection: too much vertical deviation is null", () => {
  assertEquals(
    detectSwipeDirection(-80, SWIPE_MAX_CROSS_PX + 10, 200),
    null,
  );
});

Deno.test("detectSwipeDirection: zero displacement is null", () => {
  assertEquals(detectSwipeDirection(0, 0, 100), null);
});

// ── momentumStep ─────────────────────────────────────────────────────────────

Deno.test("momentumStep: reduces velocity by friction", () => {
  const { vx, vy, active } = momentumStep(10, 0);
  approx(vx, 10 * MOMENTUM_FRICTION, 1e-6);
  approx(vy, 0, 1e-6);
  assertEquals(active, true);
});

Deno.test("momentumStep: stops when below minimum velocity", () => {
  const { vx, vy, active } = momentumStep(0.05, 0.05);
  assertEquals(vx, 0);
  assertEquals(vy, 0);
  assertEquals(active, false);
});

Deno.test("momentumStep: converges to zero after many steps", () => {
  let vx = 20;
  let vy = 15;
  let active = true;
  let steps = 0;
  while (active && steps < 500) {
    const result = momentumStep(vx, vy);
    vx = result.vx;
    vy = result.vy;
    active = result.active;
    steps++;
  }
  assertEquals(active, false);
  assertEquals(vx, 0);
  assertEquals(vy, 0);
  assert(steps < 500, "Momentum should converge in fewer than 500 steps");
});

// ── clampMomentum ────────────────────────────────────────────────────────────

Deno.test("clampMomentum: passes through low velocities", () => {
  const { vx, vy } = clampMomentum(5, 3);
  approx(vx, 5, 1e-9);
  approx(vy, 3, 1e-9);
});

Deno.test("clampMomentum: caps high velocities", () => {
  const { vx, vy } = clampMomentum(100, 0);
  approx(Math.hypot(vx, vy), MOMENTUM_MAX_VELOCITY, 1e-6);
});

Deno.test("clampMomentum: preserves direction when clamping", () => {
  const { vx, vy } = clampMomentum(60, 80);
  // Direction should be preserved (3:4 ratio).
  const ratio = vx / vy;
  approx(ratio, 60 / 80, 1e-6);
});

Deno.test("clampMomentum: zero velocity stays zero", () => {
  const { vx, vy } = clampMomentum(0, 0);
  assertEquals(vx, 0);
  assertEquals(vy, 0);
});

// ── pinchZoomToward ──────────────────────────────────────────────────────────

Deno.test("pinchZoomToward: centre pinch has zero pan offset", () => {
  const { panX, panY, zoom } = pinchZoomToward(200, 150, 400, 300, -10);
  approx(panX, 0, 1e-9);
  approx(panY, 0, 1e-9);
  assertEquals(zoom, -10);
});

Deno.test("pinchZoomToward: off-centre pinch shifts toward midpoint", () => {
  // Pinch in top-right quadrant (midpoint at 300, 75 on 400×300 canvas).
  const { panX, panY } = pinchZoomToward(300, 75, 400, 300, -10);
  // midX > centre → nx > 0 → panX should be negative (zoom in shifts right).
  assert(panX < 0, `Expected negative panX, got ${panX}`);
  // midY < centre → ny < 0 → panY should be positive.
  assert(panY > 0, `Expected positive panY, got ${panY}`);
});

Deno.test("pinchZoomToward: zoom-out reverses pan direction", () => {
  const zoomIn = pinchZoomToward(300, 75, 400, 300, -10);
  const zoomOut = pinchZoomToward(300, 75, 400, 300, 10);
  // Pan directions should be opposite.
  assert(
    zoomIn.panX * zoomOut.panX < 0,
    "Pan X should reverse between zoom in and out",
  );
});

Deno.test("pinchZoomToward: zero canvas dimensions return zero pan", () => {
  const { panX, panY } = pinchZoomToward(100, 100, 0, 0, -10);
  approx(panX, 0, 1e-9);
  approx(panY, 0, 1e-9);
});

// ── clampZoomDistance ─────────────────────────────────────────────────────────

Deno.test("clampZoomDistance: within range passes through", () => {
  assertEquals(clampZoomDistance(500), 500);
});

Deno.test("clampZoomDistance: below minimum clamps to minimum", () => {
  assertEquals(clampZoomDistance(5), ZOOM_MIN_DISTANCE);
});

Deno.test("clampZoomDistance: above maximum clamps to maximum", () => {
  assertEquals(clampZoomDistance(2000), ZOOM_MAX_DISTANCE);
});

Deno.test("clampZoomDistance: exactly at bounds passes through", () => {
  assertEquals(clampZoomDistance(ZOOM_MIN_DISTANCE), ZOOM_MIN_DISTANCE);
  assertEquals(clampZoomDistance(ZOOM_MAX_DISTANCE), ZOOM_MAX_DISTANCE);
});
