/**
 * Pure, DOM-free touch gesture helpers for the graph explorer (#106).
 *
 * All functions are stateless and testable in Deno. Browser-specific event
 * wiring lives in graph.js; this module provides the maths and thresholds.
 *
 * Australian English spelling throughout.
 */

/* ── Constants ──────────────────────────────────────────────────────────── */

/** Minimum finger movement (CSS px) to distinguish a drag from a tap. */
export const TAP_THRESHOLD_PX = 10;

/** Duration (ms) within which a release counts as a tap (not a long press). */
export const TAP_MAX_DURATION_MS = 300;

/** Duration (ms) a finger must be held before triggering a long press. */
export const LONG_PRESS_MS = 500;

/** Momentum friction factor per frame (multiplied each tick). */
export const MOMENTUM_FRICTION = 0.92;

/** Minimum velocity magnitude below which momentum stops. */
export const MOMENTUM_MIN_VELOCITY = 0.15;

/** Maximum momentum initial velocity (CSS px/frame) to prevent flinging. */
export const MOMENTUM_MAX_VELOCITY = 40;

/** Minimum horizontal swipe distance (CSS px) to register a swipe. */
export const SWIPE_MIN_DISTANCE_PX = 60;

/** Maximum vertical deviation (CSS px) allowed during a horizontal swipe. */
export const SWIPE_MAX_CROSS_PX = 40;

/** Maximum swipe duration (ms) — slower movements are treated as drags. */
export const SWIPE_MAX_DURATION_MS = 400;

/** Minimum zoom distance between camera and origin. */
export const ZOOM_MIN_DISTANCE = 20;

/** Maximum zoom distance between camera and origin. */
export const ZOOM_MAX_DISTANCE = 1400;

/** Touch feedback scale factor applied on touch-start. */
export const TOUCH_SCALE_FACTOR = 1.12;

/** Duration (ms) for the ripple feedback animation on tap. */
export const RIPPLE_DURATION_MS = 350;

/* ── Helpers ────────────────────────────────────────────────────────────── */

/**
 * Classify a single-finger touch as either a tap or a drag based on
 * movement distance and elapsed time.
 *
 * @param {number} dx - Horizontal movement in CSS px.
 * @param {number} dy - Vertical movement in CSS px.
 * @param {number} durationMs - Time between touchstart and touchend.
 * @returns {"tap" | "drag" | "longpress"}
 */
export function classifyTouch(dx, dy, durationMs) {
  const dist = Math.hypot(dx, dy);
  if (dist > TAP_THRESHOLD_PX) return "drag";
  if (durationMs > LONG_PRESS_MS) return "longpress";
  if (durationMs <= TAP_MAX_DURATION_MS) return "tap";
  return "drag";
}

/**
 * Detect a horizontal swipe from start/end coordinates and timing.
 *
 * @param {number} dx - Horizontal displacement (end.x − start.x).
 * @param {number} dy - Vertical displacement (end.y − start.y).
 * @param {number} durationMs - Gesture duration in ms.
 * @returns {"left" | "right" | null}
 */
export function detectSwipeDirection(dx, dy, durationMs) {
  if (durationMs > SWIPE_MAX_DURATION_MS) return null;
  if (Math.abs(dy) > SWIPE_MAX_CROSS_PX) return null;
  if (Math.abs(dx) < SWIPE_MIN_DISTANCE_PX) return null;
  return dx < 0 ? "left" : "right";
}

/**
 * Apply a single momentum deceleration step.
 *
 * @param {number} vx - Current X velocity.
 * @param {number} vy - Current Y velocity.
 * @returns {{ vx: number, vy: number, active: boolean }}
 */
export function momentumStep(vx, vy) {
  const nvx = vx * MOMENTUM_FRICTION;
  const nvy = vy * MOMENTUM_FRICTION;
  const speed = Math.hypot(nvx, nvy);
  if (speed < MOMENTUM_MIN_VELOCITY) {
    return { vx: 0, vy: 0, active: false };
  }
  return { vx: nvx, vy: nvy, active: true };
}

/**
 * Clamp initial momentum velocity to a safe maximum.
 *
 * @param {number} vx - Raw X velocity.
 * @param {number} vy - Raw Y velocity.
 * @returns {{ vx: number, vy: number }}
 */
export function clampMomentum(vx, vy) {
  const speed = Math.hypot(vx, vy);
  if (speed <= MOMENTUM_MAX_VELOCITY || speed < 1e-9) {
    return { vx, vy };
  }
  const scale = MOMENTUM_MAX_VELOCITY / speed;
  return { vx: vx * scale, vy: vy * scale };
}

/**
 * Compute the zoom delta directed toward the pinch midpoint rather than
 * the canvas centre. Returns the camera position offset to apply.
 *
 * The approach: when zooming, shift the camera slightly toward the screen
 * point under the pinch midpoint so that point stays roughly stationary.
 *
 * @param {number} midX - Pinch midpoint X in CSS px (relative to canvas).
 * @param {number} midY - Pinch midpoint Y in CSS px (relative to canvas).
 * @param {number} canvasW - Canvas width in CSS px.
 * @param {number} canvasH - Canvas height in CSS px.
 * @param {number} zoomDelta - Signed zoom amount (negative = zoom in).
 * @returns {{ panX: number, panY: number, zoom: number }}
 */
export function pinchZoomToward(midX, midY, canvasW, canvasH, zoomDelta) {
  // Normalise midpoint to [-1, 1] range from canvas centre.
  const nx = canvasW > 0 ? (midX - canvasW / 2) / (canvasW / 2) : 0;
  const ny = canvasH > 0 ? (midY - canvasH / 2) / (canvasH / 2) : 0;

  // Bias the zoom toward the midpoint by shifting the camera.
  // The shift is proportional to how far the midpoint is from centre.
  const panX = nx * zoomDelta * 0.15;
  const panY = ny * zoomDelta * 0.15;

  return { panX, panY, zoom: zoomDelta };
}

/**
 * Clamp a camera distance to the allowed zoom range.
 *
 * @param {number} distance - Current camera distance from origin.
 * @returns {number} Clamped distance.
 */
export function clampZoomDistance(distance) {
  return Math.max(ZOOM_MIN_DISTANCE, Math.min(ZOOM_MAX_DISTANCE, distance));
}
