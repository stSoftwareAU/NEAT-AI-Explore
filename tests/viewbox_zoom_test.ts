/**
 * SVG viewBox zoom/pan maths tests (Issue #540).
 *
 * The Sankey needs zoom and pan on a phone: the published snapshot is 33 layers
 * wide, so the whole diagram scaled to a phone is an illegible strip and the
 * viewer has to look at a window on it instead. All of that is arithmetic on
 * the `viewBox`, so it is pinned here rather than left to a browser. The
 * invariants that matter are that the window keeps the pane's aspect ratio
 * (so nothing is letterboxed or distorted), that it never escapes the diagram,
 * that zooming about a point keeps that point still, and that the phone's
 * opening view is a readable full-height screenful rather than the whole strip.
 */

import { approx, assert, assertEquals } from "./test_helpers.ts";

import {
  clampWindow,
  contentDelta,
  contentPointAt,
  fitHeightWindow,
  fitWindow,
  MAX_ZOOM,
  MIN_WINDOW_UNITS,
  panWindow,
  touchDistance,
  touchMidpoint,
  viewBoxString,
  zoomOf,
  zoomWindow,
} from "../docs/shared/viewbox_zoom.js";

// deno-lint-ignore no-explicit-any
type Any = any;

/** A square-ish diagram, and the very wide strip the real snapshot produces. */
const CONTENT = { width: 800, height: 400 };
const STRIP = { width: 4356, height: 520 };

/** Aspect of a phone-sized diagram pane (390px wide, 62vh of 844px tall). */
const PHONE_ASPECT = 370 / 523;

Deno.test("the fit window shows the whole diagram at the pane's aspect", () => {
  const win = fitWindow(CONTENT, 2);
  assertEquals(win.w, 800);
  assertEquals(win.h, 400);
  assertEquals(viewBoxString(win), "0 0 800 400");
  assertEquals(zoomOf(CONTENT, 2, win), 1);
});

Deno.test("a pane taller than the diagram centres it rather than stretching it", () => {
  // A 0.5-aspect pane showing an 800x400 (2.0) diagram: the window keeps the
  // pane's aspect, so the diagram is centred with room above and below.
  const win = fitWindow(CONTENT, 0.5);
  assertEquals(win.w, 800, "the window still spans the whole width");
  assertEquals(win.h, 1600, "…and takes its height from the pane's aspect");
  assertEquals(win.y, -600, "the diagram sits in the middle of the window");
  assertEquals(win.w / win.h, 0.5, "the aspect must match the pane exactly");
});

Deno.test("the phone opens on a full-height screenful of the strip", () => {
  const win = fitHeightWindow(STRIP, PHONE_ASPECT);
  assertEquals(win.h, STRIP.height, "the whole diagram height is in view");
  approx(win.w, STRIP.height * PHONE_ASPECT, 1e-9);
  assertEquals(win.x, 0, "it starts at the observation families on the left");
  assert(
    win.w < STRIP.width / 10,
    "a 33-layer strip must open on a fraction of its width, not all of it",
  );
  assert(
    zoomOf(STRIP, PHONE_ASPECT, win) > 10,
    "that screenful is a large magnification of the whole strip",
  );
});

Deno.test("the window can never escape the diagram", () => {
  const zoomed = zoomWindow(CONTENT, 2, fitWindow(CONTENT, 2), 4);
  const pushed = clampWindow(CONTENT, 2, { ...zoomed, x: 9999, y: -9999 });
  assertEquals(pushed.x, CONTENT.width - pushed.w, "stops at the right edge");
  assertEquals(pushed.y, 0, "stops at the top edge");
  assert(pushed.x + pushed.w <= CONTENT.width + 1e-9);
  assert(pushed.y + pushed.h <= CONTENT.height + 1e-9);
});

Deno.test("zooming out is bounded by the whole diagram", () => {
  let win = zoomWindow(CONTENT, 2, fitWindow(CONTENT, 2), 4, {
    x: 700,
    y: 350,
  });
  win = panWindow(CONTENT, 2, win, 50, 50);
  win = zoomWindow(CONTENT, 2, win, 1 / 100);
  assertEquals(zoomOf(CONTENT, 2, win), 1);
  assertEquals(viewBoxString(win), "0 0 800 400");
});

Deno.test("zooming in is bounded so the view never collapses to nothing", () => {
  const win = zoomWindow(
    STRIP,
    PHONE_ASPECT,
    fitWindow(STRIP, PHONE_ASPECT),
    1e6,
  );
  assert(win.w >= MIN_WINDOW_UNITS, `window narrowed to ${win.w} units`);
  assert(
    zoomOf(STRIP, PHONE_ASPECT, win) <= MAX_ZOOM + 1e-6,
    "magnification must be capped",
  );
});

Deno.test("zooming about a point keeps that point under the same pixel", () => {
  const rect = { left: 0, top: 0, width: 390, height: 523 };
  const start = fitHeightWindow(STRIP, PHONE_ASPECT);
  const finger = { x: 240, y: 120 };
  const before = contentPointAt(start, rect, finger);
  const after = contentPointAt(
    zoomWindow(STRIP, PHONE_ASPECT, start, 2, before),
    rect,
    finger,
  );
  approx(after.x, before.x, 1e-6, "the focus x must not slide");
  approx(after.y, before.y, 1e-6, "the focus y must not slide");
});

Deno.test("panning moves the window and stops at the edges", () => {
  const win = zoomWindow(CONTENT, 2, fitWindow(CONTENT, 2), 2, {
    x: 400,
    y: 200,
  });
  assertEquals(win.x, 200);
  assertEquals(panWindow(CONTENT, 2, win, 1000, 0).x, 400, "clamped right");
  assertEquals(panWindow(CONTENT, 2, win, -1000, 0).x, 0, "clamped left");
});

Deno.test("the whole-diagram view cannot be panned at all", () => {
  const win = panWindow(CONTENT, 2, fitWindow(CONTENT, 2), 300, 300);
  assertEquals(win.x, 0);
  assertEquals(win.y, 0);
});

Deno.test("client points and drags map straight through the pane", () => {
  const win = { x: 100, y: 50, w: 400, h: 200 };
  const rect = { left: 20, top: 60, width: 200, height: 100 };

  const centre = contentPointAt(win, rect, { x: 20 + 100, y: 60 + 50 });
  approx(centre.x, 300, 1e-9);
  approx(centre.y, 150, 1e-9);

  const { dx, dy } = contentDelta(win, rect, 10, -20);
  assertEquals(dx, 20, "the pane is half size, so 10px is 20 content units");
  assertEquals(dy, -40);
});

Deno.test("pinch geometry: distance and midpoint", () => {
  const a = { x: 0, y: 0 };
  const b = { x: 30, y: 40 };
  assertEquals(touchDistance(a, b), 50);
  assertEquals(touchMidpoint(a, b).x, 15);
  assertEquals(touchMidpoint(a, b).y, 20);
});

Deno.test("a content box with no size fails loudly", () => {
  for (
    const bad of [{ width: 0, height: 10 }, { width: 10, height: -1 }, null]
  ) {
    let threw = false;
    try {
      fitWindow(bad as Any, 1);
    } catch {
      threw = true;
    }
    assert(threw, `fitWindow(${JSON.stringify(bad)}) must throw`);
  }
});

Deno.test("a missing pane aspect fails loudly", () => {
  for (const bad of [0, -1, Number.NaN, undefined]) {
    let threw = false;
    try {
      fitWindow(CONTENT, bad as Any);
    } catch {
      threw = true;
    }
    assert(threw, `an aspect of ${String(bad)} must throw`);
  }
});

Deno.test("a zero-size rendered box fails loudly rather than dividing by zero", () => {
  const win = fitWindow(CONTENT, 2);
  for (
    const call of [
      () =>
        contentPointAt(win, { left: 0, top: 0, width: 0, height: 0 }, {
          x: 0,
          y: 0,
        }),
      () => contentDelta(win, { width: 0, height: 0 }, 1, 1),
    ]
  ) {
    let threw = false;
    try {
      call();
    } catch {
      threw = true;
    }
    assert(threw, "an unmeasured element must throw, not produce Infinity");
  }
});
