/**
 * Zoom/pan gestures for the Sankey diagram (Issue #540).
 *
 * The published snapshot is 33 layers wide, so on a phone the whole diagram is
 * an illegible strip. The phone therefore opens on a full-height *window* over
 * the diagram and the viewer moves it around; pinch, drag, wheel and keyboard
 * all drive the same window through the maths in
 * `docs/shared/viewbox_zoom.js`, so this file stays a thin DOM adapter.
 *
 * Keyboard parity is deliberate: `+`, `-`, `0` and the arrow keys drive exactly
 * the same window the touch gestures do, so magnifying the diagram never
 * becomes a touch-only capability.
 */

import {
  clampWindow,
  contentDelta,
  contentPointAt,
  fitHeightWindow,
  fitWindow,
  KEY_PAN_FRACTION,
  maxZoomFor,
  panWindow,
  touchDistance,
  touchMidpoint,
  viewBoxString,
  ZOOM_STEP,
  zoomOf,
  zoomWindow,
} from "../shared/viewbox_zoom.js";
import { TAP_THRESHOLD_PX } from "../shared/touch_gestures.js";

/** Wheel notch magnification — gentler than a button press. */
const WHEEL_STEP = 1.15;

/**
 * Create a zoom/pan controller.
 *
 * The controller owns the window; `attach` points it at a freshly rendered SVG
 * and resets to that layout's opening view.
 *
 * @param {object} [options]
 * @param {(el: unknown) => {left: number, top: number, width: number, height: number}} [options.getRect]
 *   Measure the rendered element. Injectable so the gesture contract is
 *   testable without a layout engine.
 * @param {(zoom: number) => void} [options.onChange]
 */
export function createZoomPanController(options = {}) {
  const measure = options.getRect ??
    ((el) =>
      el?.getBoundingClientRect?.() ??
        { left: 0, top: 0, width: 0, height: 0 });
  const onChange = options.onChange ?? (() => {});

  /** @type {any} */
  let target = null;
  let content = { width: 1, height: 1 };
  let aspect = 1;
  let win = { x: 0, y: 0, w: 1, h: 1 };
  /** The view `attach` opened on — what "Reset" goes back to. */
  let initialWindow = win;
  let panned = false;

  // Live gesture state.
  let dragging = false;
  let lastPoint = null;
  let dragDistance = 0;
  let pinchDistance = 0;

  function rect() {
    return measure(target);
  }

  function apply() {
    if (!target) return;
    target.setAttribute("viewBox", viewBoxString(win));
    const zoom = zoomOf(content, aspect, win);
    target.classList?.toggle("isZoomed", zoom > 1.0001);
    onChange(zoom);
  }

  function setWindow(next) {
    win = clampWindow(content, aspect, next);
    apply();
  }

  function zoomBy(factor, focus) {
    setWindow(zoomWindow(content, aspect, win, factor, focus));
  }

  function focusFromClient(clientX, clientY) {
    const box = rect();
    if (!(box.width > 0) || !(box.height > 0)) return undefined;
    return contentPointAt(win, box, { x: clientX, y: clientY });
  }

  function panByPixels(dxPx, dyPx) {
    const box = rect();
    if (!(box.width > 0) || !(box.height > 0)) return;
    const { dx, dy } = contentDelta(win, box, dxPx, dyPx);
    setWindow(panWindow(content, aspect, win, dx, dy));
  }

  function panByFraction(fx, fy) {
    setWindow(panWindow(content, aspect, win, win.w * fx, win.h * fy));
  }

  /** True when the diagram is magnified beyond the whole-diagram view. */
  function isZoomed() {
    return zoomOf(content, aspect, win) > 1.0001;
  }

  // ── Gesture handlers ────────────────────────────────────────────────────

  function onWheel(event) {
    event.preventDefault?.();
    const factor = (event.deltaY ?? 0) < 0 ? WHEEL_STEP : 1 / WHEEL_STEP;
    zoomBy(factor, focusFromClient(event.clientX, event.clientY));
  }

  function onPointerDown(event) {
    // Touch is handled by the touch listeners so a pinch is not mistaken for
    // two independent drags.
    if (event.pointerType === "touch") return;
    dragging = true;
    dragDistance = 0;
    lastPoint = { x: event.clientX, y: event.clientY };
    target?.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event) {
    if (!dragging || !lastPoint) return;
    const dx = event.clientX - lastPoint.x;
    const dy = event.clientY - lastPoint.y;
    lastPoint = { x: event.clientX, y: event.clientY };
    dragDistance += Math.hypot(dx, dy);
    if (dragDistance > TAP_THRESHOLD_PX) panned = true;
    panByPixels(-dx, -dy);
  }

  function endDrag() {
    dragging = false;
    lastPoint = null;
  }

  function touchPoints(event) {
    return Array.from(event.touches ?? []).map((t) => ({
      x: t.clientX,
      y: t.clientY,
    }));
  }

  function onTouchStart(event) {
    const points = touchPoints(event);
    if (points.length === 2) {
      pinchDistance = touchDistance(points[0], points[1]);
      dragging = false;
      lastPoint = null;
      return;
    }
    if (points.length === 1) {
      dragging = true;
      dragDistance = 0;
      lastPoint = points[0];
    }
  }

  function onTouchMove(event) {
    const points = touchPoints(event);
    if (points.length === 2) {
      event.preventDefault?.();
      const distance = touchDistance(points[0], points[1]);
      if (pinchDistance > 0 && distance > 0) {
        const mid = touchMidpoint(points[0], points[1]);
        zoomBy(distance / pinchDistance, focusFromClient(mid.x, mid.y));
        panned = true;
      }
      pinchDistance = distance;
      return;
    }
    if (points.length === 1 && dragging && lastPoint) {
      // Showing the whole diagram there is nothing to pan, so let the page
      // scroll rather than swallowing the gesture.
      if (!isZoomed()) return;
      event.preventDefault?.();
      const dx = points[0].x - lastPoint.x;
      const dy = points[0].y - lastPoint.y;
      lastPoint = points[0];
      dragDistance += Math.hypot(dx, dy);
      if (dragDistance > TAP_THRESHOLD_PX) panned = true;
      panByPixels(-dx, -dy);
    }
  }

  function onTouchEnd(event) {
    if ((event.touches?.length ?? 0) < 2) pinchDistance = 0;
    if ((event.touches?.length ?? 0) === 0) endDrag();
  }

  function onKeyDown(event) {
    switch (event.key) {
      case "+":
      case "=":
        event.preventDefault?.();
        zoomBy(ZOOM_STEP);
        return;
      case "-":
      case "_":
        event.preventDefault?.();
        zoomBy(1 / ZOOM_STEP);
        return;
      case "0":
        event.preventDefault?.();
        setWindow(initialWindow);
        return;
      case "ArrowLeft":
        event.preventDefault?.();
        panByFraction(-KEY_PAN_FRACTION, 0);
        return;
      case "ArrowRight":
        event.preventDefault?.();
        panByFraction(KEY_PAN_FRACTION, 0);
        return;
      case "ArrowUp":
        event.preventDefault?.();
        panByFraction(0, -KEY_PAN_FRACTION);
        return;
      case "ArrowDown":
        event.preventDefault?.();
        panByFraction(0, KEY_PAN_FRACTION);
        return;
    }
  }

  const bindings = [
    ["wheel", onWheel],
    ["pointerdown", onPointerDown],
    ["pointermove", onPointerMove],
    ["pointerup", endDrag],
    ["pointercancel", endDrag],
    ["pointerleave", endDrag],
    ["touchstart", onTouchStart],
    ["touchmove", onTouchMove],
    ["touchend", onTouchEnd],
    ["touchcancel", onTouchEnd],
    ["keydown", onKeyDown],
  ];

  function detach() {
    if (!target) return;
    for (const [type, handler] of bindings) {
      target.removeEventListener(type, handler);
    }
    target = null;
  }

  return {
    /**
     * Point the controller at a rendered SVG and reset the window.
     *
     * @param {unknown} svgEl
     * @param {{width: number, height: number}} contentBox — the diagram's own
     *   coordinate box.
     * @param {{aspect?: number, initial?: "fit"|"fit-height"}} [view]
     *   `aspect` is the rendered pane's width ÷ height; it defaults to the
     *   content's own aspect, which is what keeps the desktop's `height: auto`
     *   diagram exactly the shape it was. `initial: "fit-height"` opens on one
     *   full-height screenful — the phone's view of a 33-layer diagram.
     */
    attach(svgEl, contentBox, view = {}) {
      detach();
      if (!svgEl) {
        throw new Error(
          "createZoomPanController.attach requires an SVG element",
        );
      }
      target = svgEl;
      content = { width: contentBox.width, height: contentBox.height };
      const requested = Number(view.aspect);
      aspect = Number.isFinite(requested) && requested > 0
        ? requested
        : content.width / content.height;
      win = view.initial === "fit-height"
        ? fitHeightWindow(content, aspect)
        : fitWindow(content, aspect);
      initialWindow = { ...win };
      for (const [type, handler] of bindings) {
        target.addEventListener(type, handler);
      }
      apply();
    },
    detach,
    /** The live window, in content units. */
    window: () => ({ ...win }),
    setWindow,
    /** Magnification relative to the whole diagram. */
    zoom: () => zoomOf(content, aspect, win),
    /** The deepest magnification this diagram allows. */
    maxZoom: () => maxZoomFor(content, aspect),
    /**
     * Magnification relative to the opening view, which is what the readout
     * shows: a phone opens on a heavily magnified screenful of a 33-layer
     * strip, and "1182%" would be a meaningless number to open on.
     */
    displayZoom: () =>
      zoomOf(content, aspect, win) / zoomOf(content, aspect, initialWindow),
    /** True when the diagram is exactly where `attach` left it. */
    isInitialView: () => viewBoxString(win) === viewBoxString(initialWindow),
    zoomBy,
    zoomIn: (focus) => zoomBy(ZOOM_STEP, focus),
    zoomOut: (focus) => zoomBy(1 / ZOOM_STEP, focus),
    reset: () => setWindow(initialWindow),
    panByPixels,
    isZoomed,
    /**
     * Whether the last gesture moved the diagram, clearing the flag.
     *
     * The view swallows the `click` that ends a drag, so a pan does not read as
     * a tap on the background and clear the selection.
     */
    consumePan() {
      const was = panned;
      panned = false;
      return was;
    },
    // Exposed for the handlers under test; the gestures above are the real API.
    handlers: {
      onWheel,
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onKeyDown,
    },
  };
}

/**
 * Wire the header zoom buttons to a controller.
 *
 * Buttons are the keyboard/assistive route to the same window the pinch gesture
 * drives, and they report the live magnification so a viewer knows where they
 * are in a diagram far wider than the screen.
 *
 * @param {Document} doc
 * @param {ReturnType<typeof createZoomPanController>} controller
 * @returns {{ update: () => void }}
 */
export function attachZoomControls(doc, controller) {
  const zoomIn = doc.getElementById("zoomIn");
  const zoomOut = doc.getElementById("zoomOut");
  const zoomReset = doc.getElementById("zoomReset");
  const readout = doc.getElementById("zoomLevel");
  if (!zoomIn || !zoomOut || !zoomReset) {
    // Fail loud rather than silently shipping a diagram nobody can magnify.
    throw new Error(
      "Zoom controls #zoomIn/#zoomOut/#zoomReset are missing from the page",
    );
  }

  function update() {
    const zoom = controller.zoom();
    zoomIn.disabled = zoom >= controller.maxZoom() - 1e-6;
    zoomOut.disabled = zoom <= 1.0001;
    zoomReset.disabled = controller.isInitialView();
    if (readout) {
      readout.textContent = `${Math.round(controller.displayZoom() * 100)}%`;
    }
  }

  zoomIn.addEventListener("click", () => {
    controller.zoomIn();
    update();
  });
  zoomOut.addEventListener("click", () => {
    controller.zoomOut();
    update();
  });
  zoomReset.addEventListener("click", () => {
    controller.reset();
    update();
  });
  update();
  return { update };
}
