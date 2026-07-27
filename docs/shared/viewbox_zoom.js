/**
 * Pure zoom/pan maths for an SVG `viewBox` window (Issue #540).
 *
 * The published snapshot lays out as 33 layers, so the whole Sankey is a very
 * wide, short strip. Scaled to fit a phone that is a few illegible pixels tall,
 * which is exactly the #540 complaint — the phone needs to look at a *window*
 * on the diagram and move it around, not at the whole thing shrunk down.
 *
 * So the view state here is the window itself, in content units:
 * `{ x, y, w, h }`, written straight into the SVG's `viewBox`. Its aspect ratio
 * always matches the pane it is drawn into, so `preserveAspectRatio` never
 * letterboxes and a client point maps back to content with a single divide.
 *
 * Zooming out is bounded by the whole diagram (`fitWindow`); zooming in is
 * bounded so a band can be magnified to a comfortable touch target but not
 * beyond. All of it is arithmetic, so it lives here, DOM-free and unit-tested,
 * and `docs/sankey/zoom_pan.js` only binds gestures to it.
 */

/**
 * Deepest magnification, as a multiple of the fit-the-whole-diagram window.
 * Generous because a 33-layer diagram needs a lot of magnification before one
 * layer fills a phone; the absolute floor below stops it running away.
 */
export const MAX_ZOOM = 100;

/** Narrowest window, in content units — zooming in past this shows nothing. */
export const MIN_WINDOW_UNITS = 40;

/** Fraction of the visible window a single arrow-key press pans. */
export const KEY_PAN_FRACTION = 0.2;

/** Magnification applied by one zoom button press. */
export const ZOOM_STEP = 1.5;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function requireContent(content) {
  const width = Number(content?.width);
  const height = Number(content?.height);
  if (!(width > 0) || !(height > 0)) {
    throw new Error(
      "viewbox_zoom requires a content box with a positive width and height",
    );
  }
  return { width, height };
}

function requireAspect(aspect) {
  const a = Number(aspect);
  if (!(a > 0) || !Number.isFinite(a)) {
    throw new Error(
      `viewbox_zoom requires a positive aspect ratio, got ${aspect}`,
    );
  }
  return a;
}

/** Narrowest window allowed for a diagram whose fit window is `fitW` wide. */
function narrowestWindow(fitW) {
  return Math.min(fitW, Math.max(fitW / MAX_ZOOM, MIN_WINDOW_UNITS));
}

/**
 * @typedef {{x: number, y: number, w: number, h: number}} ViewWindow
 *   A window on the diagram, in content units — written to the SVG `viewBox`.
 */

/**
 * The deepest magnification actually reachable for this diagram.
 *
 * `MAX_ZOOM` is the relative ceiling, but a small diagram hits the absolute
 * `MIN_WINDOW_UNITS` floor first — the zoom-in control needs the real limit so
 * it can report itself unavailable at the right point.
 *
 * @param {{width: number, height: number}} content
 * @param {number} aspect
 * @returns {number}
 */
export function maxZoomFor(content, aspect) {
  const fit = fitWindow(content, aspect);
  return fit.w / narrowestWindow(fit.w);
}

/**
 * The zoomed-all-the-way-out window: the whole diagram, centred, at `aspect`.
 *
 * @param {{width: number, height: number}} content
 * @param {number} aspect — rendered pane width ÷ height.
 * @returns {ViewWindow}
 */
export function fitWindow(content, aspect) {
  const box = requireContent(content);
  const a = requireAspect(aspect);
  const w = Math.max(box.width, box.height * a);
  const h = w / a;
  return { x: (box.width - w) / 2, y: (box.height - h) / 2, w, h };
}

/**
 * A window as tall as the whole diagram, anchored at its left edge.
 *
 * This is the phone's opening view: a 33-layer strip squeezed to a phone's
 * width is illegible, but one screenful of it at full height is readable, and
 * the observation families the viewer starts from are on the left.
 *
 * @param {{width: number, height: number}} content
 * @param {number} aspect
 * @returns {ViewWindow}
 */
export function fitHeightWindow(content, aspect) {
  const box = requireContent(content);
  const a = requireAspect(aspect);
  return clampWindow(box, a, {
    x: 0,
    y: 0,
    w: box.height * a,
    h: box.height,
  });
}

/**
 * Clamp a window: never wider than the whole diagram, never narrower than the
 * magnification floor, and never panned off the content it is looking at.
 *
 * @param {{width: number, height: number}} content
 * @param {number} aspect
 * @param {ViewWindow} win
 * @returns {ViewWindow}
 */
export function clampWindow(content, aspect, win) {
  const box = requireContent(content);
  const a = requireAspect(aspect);
  const fit = fitWindow(box, a);
  const minW = narrowestWindow(fit.w);
  const rawW = Number(win?.w);
  const w = clamp(
    Number.isFinite(rawW) && rawW > 0 ? rawW : fit.w,
    minW,
    fit.w,
  );
  const h = w / a;

  const rawX = Number(win?.x);
  const rawY = Number(win?.y);
  const x = Number.isFinite(rawX) ? rawX : 0;
  const y = Number.isFinite(rawY) ? rawY : 0;

  // A window wider than the content centres it rather than pinning it left.
  return {
    w,
    h,
    x: w >= box.width ? (box.width - w) / 2 : clamp(x, 0, box.width - w),
    y: h >= box.height ? (box.height - h) / 2 : clamp(y, 0, box.height - h),
  };
}

/**
 * Zoom by `factor` about a fixed point, so the content under the pinch centre
 * (or the pointer) stays put rather than sliding away.
 *
 * @param {{width: number, height: number}} content
 * @param {number} aspect
 * @param {ViewWindow} win
 * @param {number} factor — >1 zooms in, <1 zooms out.
 * @param {{x: number, y: number}} [focus] — fixed point in content units.
 * @returns {ViewWindow}
 */
export function zoomWindow(content, aspect, win, factor, focus) {
  const box = requireContent(content);
  const a = requireAspect(aspect);
  const current = clampWindow(box, a, win);
  const f = Number(factor);
  if (!Number.isFinite(f) || f <= 0) return current;

  const next = clampWindow(box, a, { ...current, w: current.w / f });
  const fx = Number.isFinite(Number(focus?.x))
    ? Number(focus.x)
    : current.x + current.w / 2;
  const fy = Number.isFinite(Number(focus?.y))
    ? Number(focus.y)
    : current.y + current.h / 2;
  // Keep the focus at the same fraction across the window.
  return clampWindow(box, a, {
    ...next,
    x: fx - ((fx - current.x) / current.w) * next.w,
    y: fy - ((fy - current.y) / current.h) * next.h,
  });
}

/**
 * Pan by a content-space offset.
 *
 * @param {{width: number, height: number}} content
 * @param {number} aspect
 * @param {ViewWindow} win
 * @param {number} dx
 * @param {number} dy
 * @returns {ViewWindow}
 */
export function panWindow(content, aspect, win, dx, dy) {
  const box = requireContent(content);
  const a = requireAspect(aspect);
  const current = clampWindow(box, a, win);
  return clampWindow(box, a, {
    ...current,
    x: current.x + (Number(dx) || 0),
    y: current.y + (Number(dy) || 0),
  });
}

/**
 * A window as an SVG `viewBox` attribute value.
 *
 * @param {ViewWindow} win
 * @returns {string}
 */
export function viewBoxString(win) {
  const round = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
  return `${round(win?.x)} ${round(win?.y)} ${round(win?.w)} ${round(win?.h)}`;
}

/**
 * Magnification relative to the whole diagram — what the readout shows.
 *
 * @param {{width: number, height: number}} content
 * @param {number} aspect
 * @param {ViewWindow} win
 * @returns {number}
 */
export function zoomOf(content, aspect, win) {
  const fit = fitWindow(content, aspect);
  const current = clampWindow(content, aspect, win);
  return fit.w / current.w;
}

/**
 * Convert a client (viewport) point to content units.
 *
 * The window shares the pane's aspect, so there is no letterbox to correct for.
 *
 * @param {ViewWindow} win
 * @param {{left: number, top: number, width: number, height: number}} rect
 * @param {{x: number, y: number}} point — client coordinates.
 * @returns {{x: number, y: number}}
 */
export function contentPointAt(win, rect, point) {
  const rw = Number(rect?.width);
  const rh = Number(rect?.height);
  if (!(rw > 0) || !(rh > 0)) {
    throw new Error(
      "contentPointAt requires a rendered box with a positive size",
    );
  }
  return {
    x: win.x +
      ((Number(point?.x) || 0) - (Number(rect?.left) || 0)) * win.w / rw,
    y: win.y +
      ((Number(point?.y) || 0) - (Number(rect?.top) || 0)) * win.h / rh,
  };
}

/**
 * Convert a movement in rendered pixels to a movement in content units.
 *
 * @param {ViewWindow} win
 * @param {{width: number, height: number}} rect
 * @param {number} dxPx
 * @param {number} dyPx
 * @returns {{dx: number, dy: number}}
 */
export function contentDelta(win, rect, dxPx, dyPx) {
  const rw = Number(rect?.width);
  const rh = Number(rect?.height);
  if (!(rw > 0) || !(rh > 0)) {
    throw new Error(
      "contentDelta requires a rendered box with a positive size",
    );
  }
  return {
    dx: (Number(dxPx) || 0) * win.w / rw,
    dy: (Number(dyPx) || 0) * win.h / rh,
  };
}

/**
 * Distance between two touch points — the raw signal for a pinch.
 *
 * @param {{x: number, y: number}} a
 * @param {{x: number, y: number}} b
 * @returns {number}
 */
export function touchDistance(a, b) {
  return Math.hypot(
    (Number(b?.x) || 0) - (Number(a?.x) || 0),
    (Number(b?.y) || 0) - (Number(a?.y) || 0),
  );
}

/**
 * Midpoint of two touch points — the fixed point of a pinch.
 *
 * @param {{x: number, y: number}} a
 * @param {{x: number, y: number}} b
 * @returns {{x: number, y: number}}
 */
export function touchMidpoint(a, b) {
  return {
    x: ((Number(a?.x) || 0) + (Number(b?.x) || 0)) / 2,
    y: ((Number(a?.y) || 0) + (Number(b?.y) || 0)) / 2,
  };
}
