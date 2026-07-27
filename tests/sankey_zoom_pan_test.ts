/**
 * Sankey zoom/pan gesture tests (Issue #540).
 *
 * The maths lives in `viewbox_zoom.js` (see `viewbox_zoom_test.ts`); these
 * tests pin the browser-facing contract the phone layout depends on:
 *
 *   1. a pinch magnifies the diagram and a one-finger drag pans it;
 *   2. the keyboard drives exactly the same view state, so magnifying is never
 *      touch-only — the "does not break keyboard navigation" criterion;
 *   3. a drag is not mistaken for a tap, so panning does not clear a selection;
 *   4. the page's zoom controls exist and stay in step with the view.
 *
 * The controls are parsed from the published page, so deleting or renaming
 * them fails here before merge.
 */

import { assert, assertEquals } from "./test_helpers.ts";
import { loadDocument, parseHtml } from "./dom_helpers.ts";

import {
  attachZoomControls,
  createZoomPanController,
} from "../docs/sankey/zoom_pan.js";

// deno-lint-ignore no-explicit-any
type Any = any;

const CONTENT = { width: 800, height: 400 };
/** A phone-sized rendered pane for the 800x400 diagram. */
const RECT = { left: 0, top: 0, width: 390, height: 195 };

function controllerFixture() {
  const doc = parseHtml(
    `<!DOCTYPE html><html><body><svg id="s"></svg></body></html>`,
  );
  const svgEl = doc.getElementById("s") as unknown as Any;
  const controller = createZoomPanController({ getRect: () => RECT });
  controller.attach(svgEl, CONTENT);
  return { doc, svgEl, controller };
}

function touchEvent(points: Array<{ x: number; y: number }>): Any {
  const event = {
    touches: points.map((p) => ({ clientX: p.x, clientY: p.y })),
  };
  let prevented = false;
  return Object.assign(event, {
    preventDefault: () => {
      prevented = true;
    },
    wasPrevented: () => prevented,
  });
}

function keyEvent(key: string): Any {
  return { key, preventDefault: () => {} };
}

Deno.test("attaching sets the viewBox to the whole diagram", () => {
  const f = controllerFixture();
  assertEquals(f.svgEl.getAttribute("viewBox"), "0 0 800 400");
  assertEquals(f.controller.zoom(), 1);
  assertEquals(f.controller.isZoomed(), false);
});

Deno.test("the phone opens on a full-height screenful of a wide diagram", () => {
  // The published snapshot lays out as a 33-layer strip; fitting all of it into
  // a phone is the illegible layout #540 exists to replace.
  const strip = { width: 4356, height: 520 };
  const doc = parseHtml(
    `<!DOCTYPE html><html><body><svg id="s"></svg></body></html>`,
  );
  const svgEl = doc.getElementById("s") as unknown as Any;
  // A phone-shaped pane: 390px wide, 62vh of an 844px screen tall.
  const pane = { left: 0, top: 0, width: 370, height: 523 };
  const controller = createZoomPanController({ getRect: () => pane });
  controller.attach(svgEl, strip, {
    aspect: pane.width / pane.height,
    initial: "fit-height",
  });

  const win = controller.window();
  assertEquals(win.h, strip.height, "the whole diagram height is in view");
  assert(
    win.w < strip.width / 10,
    "only a fraction of a 33-layer strip is in view at once",
  );
  assertEquals(win.x, 0, "it opens on the observation families at the left");
  assert(controller.isZoomed(), "that screenful is a magnified view");
  assert(controller.zoom() > 10);

  // The readout opens at 100% of that view, and Reset comes back to it.
  assertEquals(Math.round(controller.displayZoom() * 100), 100);
  controller.zoomBy(3);
  assert(!controller.isInitialView());
  controller.reset();
  assert(controller.isInitialView(), "Reset returns to the opening screenful");
  assertEquals(controller.window().x, 0);
});

Deno.test("a two-finger pinch magnifies the diagram", () => {
  const f = controllerFixture();
  const { onTouchStart, onTouchMove } = f.controller.handlers;

  onTouchStart(touchEvent([{ x: 150, y: 100 }, { x: 250, y: 100 }]));
  const spread = touchEvent([{ x: 100, y: 100 }, { x: 300, y: 100 }]);
  onTouchMove(spread);

  assertEquals(f.controller.zoom(), 2, "spreading 100px→200px is 2x");
  assert(f.controller.isZoomed(), "the diagram must report itself magnified");
  assert(spread.wasPrevented(), "a pinch must not also zoom the page");
  assert(
    f.svgEl.getAttribute("viewBox") !== "0 0 800 400",
    "the viewBox must narrow",
  );

  // Pinching back in returns to the whole diagram.
  onTouchMove(touchEvent([{ x: 150, y: 100 }, { x: 250, y: 100 }]));
  assertEquals(f.controller.zoom(), 1);
});

Deno.test("a one-finger drag pans a magnified diagram", () => {
  const f = controllerFixture();
  const { onTouchStart, onTouchMove, onTouchEnd } = f.controller.handlers;
  f.controller.zoomBy(4, { x: 400, y: 200 });
  const before = f.controller.window();

  onTouchStart(touchEvent([{ x: 300, y: 100 }]));
  onTouchMove(touchEvent([{ x: 200, y: 100 }]));
  onTouchEnd(touchEvent([]));

  const after = f.controller.window();
  assert(after.x > before.x, "dragging left must move the window right");
  assertEquals(after.w, before.w, "a pan must not change the zoom");
});

Deno.test("a fully zoomed-out diagram lets the page scroll instead of panning", () => {
  const f = controllerFixture();
  const { onTouchStart, onTouchMove } = f.controller.handlers;

  onTouchStart(touchEvent([{ x: 300, y: 100 }]));
  const move = touchEvent([{ x: 200, y: 100 }]);
  onTouchMove(move);

  assertEquals(f.controller.window().x, 0);
  assertEquals(
    move.wasPrevented(),
    false,
    "with nothing to pan the page must keep its scroll",
  );
});

Deno.test("a drag is not a tap: the pan is consumed so the selection survives", () => {
  const f = controllerFixture();
  const { onPointerDown, onPointerMove, onPointerUp } = f.controller.handlers;
  f.controller.zoomBy(4);

  onPointerDown({
    pointerType: "mouse",
    pointerId: 1,
    clientX: 200,
    clientY: 100,
  });
  onPointerMove({
    pointerType: "mouse",
    pointerId: 1,
    clientX: 150,
    clientY: 100,
  });
  onPointerUp();

  assert(f.controller.consumePan(), "a real drag must report a pan");
  assertEquals(
    f.controller.consumePan(),
    false,
    "the flag is consumed once, so the next click is a genuine tap",
  );
});

Deno.test("a tap that barely moves is not treated as a pan", () => {
  const f = controllerFixture();
  const { onPointerDown, onPointerMove, onPointerUp } = f.controller.handlers;
  f.controller.zoomBy(4);

  onPointerDown({
    pointerType: "mouse",
    pointerId: 1,
    clientX: 200,
    clientY: 100,
  });
  onPointerMove({
    pointerType: "mouse",
    pointerId: 1,
    clientX: 202,
    clientY: 101,
  });
  onPointerUp();

  assertEquals(
    f.controller.consumePan(),
    false,
    "a 2px wobble must still select the node under the finger",
  );
});

Deno.test("pointer events ignore touch, leaving pinch to the touch handlers", () => {
  const f = controllerFixture();
  const { onPointerDown, onPointerMove } = f.controller.handlers;
  f.controller.zoomBy(4);
  const before = f.controller.window();

  onPointerDown({
    pointerType: "touch",
    pointerId: 1,
    clientX: 200,
    clientY: 100,
  });
  onPointerMove({
    pointerType: "touch",
    pointerId: 1,
    clientX: 100,
    clientY: 100,
  });

  assertEquals(f.controller.window().x, before.x, "touch must not double-pan");
});

Deno.test("the keyboard drives the same view state as the gestures", () => {
  const f = controllerFixture();
  const { onKeyDown } = f.controller.handlers;

  onKeyDown(keyEvent("+"));
  assert(f.controller.zoom() > 1, "+ must zoom in");
  const zoomed = f.controller.window();
  const zoomedLevel = f.controller.zoom();

  onKeyDown(keyEvent("ArrowRight"));
  assert(f.controller.window().x > zoomed.x, "ArrowRight must pan right");
  onKeyDown(keyEvent("ArrowDown"));
  assert(f.controller.window().y > zoomed.y, "ArrowDown must pan down");

  onKeyDown(keyEvent("-"));
  assert(f.controller.zoom() < zoomedLevel, "- must zoom out");

  f.controller.zoomBy(4);
  onKeyDown(keyEvent("0"));
  assertEquals(f.controller.zoom(), 1, "0 must reset");
});

Deno.test("selection keys are left alone so node activation still works", () => {
  const f = controllerFixture();
  const { onKeyDown } = f.controller.handlers;
  f.controller.zoomBy(2);
  const before = f.controller.window();
  const beforeZoom = f.controller.zoom();

  for (const key of ["Enter", " ", "Tab", "Escape"]) {
    onKeyDown(keyEvent(key));
  }
  assertEquals(f.controller.zoom(), beforeZoom);
  assertEquals(f.controller.window().x, before.x);
});

Deno.test("the wheel zooms about the pointer", () => {
  const f = controllerFixture();
  f.controller.handlers.onWheel({
    deltaY: -100,
    clientX: 0,
    clientY: 0,
    preventDefault: () => {},
  });
  const view = f.controller.window();
  assert(f.controller.zoom() > 1, "scrolling up must zoom in");
  assertEquals(view.x, 0, "zooming at the top-left corner must stay pinned");
});

Deno.test("re-attaching after a re-render resets the view", () => {
  const f = controllerFixture();
  f.controller.zoomBy(4);
  assert(f.controller.isZoomed());

  const doc = parseHtml(
    `<!DOCTYPE html><html><body><svg id="next"></svg></body></html>`,
  );
  f.controller.attach(doc.getElementById("next") as unknown as Any, CONTENT);
  assertEquals(f.controller.zoom(), 1);
  assertEquals(
    (doc.getElementById("next") as unknown as Any).getAttribute("viewBox"),
    "0 0 800 400",
  );
});

Deno.test("attaching to nothing fails loudly", () => {
  const controller = createZoomPanController({ getRect: () => RECT });
  let threw = false;
  try {
    controller.attach(null, CONTENT);
  } catch {
    threw = true;
  }
  assert(threw, "a missing SVG element must throw, not silently do nothing");
});

// ── Page controls ─────────────────────────────────────────────────────────

async function publishedControls() {
  return await loadDocument(
    new URL("../docs/sankey/index.html", import.meta.url),
  );
}

Deno.test("the published page carries keyboard-reachable zoom controls", async () => {
  const doc = await publishedControls();
  for (const id of ["zoomIn", "zoomOut", "zoomReset", "zoomLevel"]) {
    assert(doc.getElementById(id), `#${id} is missing from the Sankey page`);
  }
  assertEquals(doc.getElementById("zoomIn")!.getAttribute("type"), "button");
  assert(
    doc.getElementById("zoomIn")!.getAttribute("aria-label"),
    "the zoom-in button needs an accessible name",
  );
});

Deno.test("the zoom buttons drive the controller and report the level", async () => {
  const doc = await publishedControls() as unknown as Any;
  const controller = createZoomPanController({ getRect: () => RECT });
  controller.attach(
    parseHtml(`<svg id="s"></svg>`).getElementById("s") as unknown as Any,
    CONTENT,
  );
  const controls = attachZoomControls(doc, controller);
  controls.update();

  const zoomIn = doc.getElementById("zoomIn");
  const zoomOut = doc.getElementById("zoomOut");
  const readout = doc.getElementById("zoomLevel");

  assertEquals(readout.textContent, "100%");
  assertEquals(
    zoomOut.disabled,
    true,
    "cannot zoom out past the whole diagram",
  );

  zoomIn.dispatchEvent(new Event("click"));
  assert(controller.zoom() > 1);
  assertEquals(readout.textContent, "150%");
  assertEquals(zoomOut.disabled, false);

  // At the ceiling the zoom-in button reports itself unavailable.
  controller.zoomBy(1e6);
  controls.update();
  assertEquals(zoomIn.disabled, true);
  assertEquals(
    readout.textContent,
    `${Math.round(controller.displayZoom() * 100)}%`,
  );
});

Deno.test("a page with no zoom controls fails loudly", () => {
  const doc = parseHtml(`<!DOCTYPE html><html><body></body></html>`);
  const controller = createZoomPanController({ getRect: () => RECT });
  let threw = false;
  try {
    attachZoomControls(doc as unknown as Any, controller);
  } catch {
    threw = true;
  }
  assert(threw, "missing controls must be reported, not silently skipped");
});
