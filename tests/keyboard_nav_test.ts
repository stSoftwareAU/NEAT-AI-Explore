/**
 * Tests for docs/shared/keyboard_nav.js (Issue #529).
 *
 * The starfield camera flies on WASD/arrow keys. Two papercuts motivated this
 * module:
 *   1. Typing a snapshot URL into the header input also flew the camera,
 *      because every keydown was recorded regardless of the event target.
 *   2. Holding a movement key and then leaving the tab lost the keyup, so the
 *      camera flew forever ("stuck key").
 *
 * Both are behaviours of the key state, so they are tested here against real
 * DOM elements rather than by inspecting graph.js source.
 */

import { assert, assertEquals } from "./test_helpers.ts";
import { parseHtml } from "./dom_helpers.ts";
import {
  createFlyKeyState,
  isEditableEventTarget,
  normaliseKeyName,
} from "../docs/shared/keyboard_nav.js";

/** Builds a document containing the fixture markup and returns it. */
function fixture(html: string) {
  return parseHtml(`<!DOCTYPE html><html><body>${html}</body></html>`);
}

// ── normaliseKeyName ─────────────────────────────────────────────────────────

Deno.test("normaliseKeyName lower-cases key names", () => {
  assertEquals(normaliseKeyName("W"), "w");
  assertEquals(normaliseKeyName("ArrowUp"), "arrowup");
  assertEquals(normaliseKeyName("Shift"), "shift");
});

Deno.test("normaliseKeyName returns empty string for missing keys", () => {
  assertEquals(normaliseKeyName(undefined), "");
  assertEquals(normaliseKeyName(null), "");
});

// ── isEditableEventTarget ────────────────────────────────────────────────────

Deno.test("isEditableEventTarget is true for text entry controls", () => {
  const doc = fixture(
    `<input id="url"><textarea id="notes"></textarea><select id="pick"></select>`,
  );
  for (const id of ["url", "notes", "pick"]) {
    assert(
      isEditableEventTarget(doc.getElementById(id)),
      `Expected #${id} to be treated as editable`,
    );
  }
});

Deno.test("isEditableEventTarget is false for buttons, links and the canvas", () => {
  const doc = fixture(
    `<button id="zoom">Zoom</button><a id="trace" href="../">Trace</a>` +
      `<canvas id="glCanvas"></canvas>`,
  );
  for (const id of ["zoom", "trace", "glCanvas"]) {
    assert(
      !isEditableEventTarget(doc.getElementById(id)),
      `Expected #${id} NOT to be treated as editable`,
    );
  }
});

Deno.test("isEditableEventTarget is true inside a contenteditable host", () => {
  const doc = fixture(
    `<div contenteditable="true"><span id="inner">x</span></div>`,
  );
  assert(isEditableEventTarget(doc.getElementById("inner")));
});

Deno.test("isEditableEventTarget honours contenteditable=false", () => {
  const doc = fixture(
    `<div contenteditable="true"><div contenteditable="false"><span id="inner">x</span></div></div>`,
  );
  assert(!isEditableEventTarget(doc.getElementById("inner")));
});

Deno.test("isEditableEventTarget is false for null/undefined targets", () => {
  assert(!isEditableEventTarget(null));
  assert(!isEditableEventTarget(undefined));
});

// ── createFlyKeyState ────────────────────────────────────────────────────────

Deno.test("press records a movement key pressed over the canvas", () => {
  const doc = fixture(`<canvas id="glCanvas"></canvas>`);
  const keys = createFlyKeyState();
  assertEquals(keys.press("W", doc.getElementById("glCanvas")), true);
  assert(
    keys.has("w"),
    "Expected 'w' to be held after pressing over the canvas",
  );
});

Deno.test("press ignores movement keys typed into the snapshot URL input", () => {
  const doc = fixture(`<input id="fetchUrl">`);
  const input = doc.getElementById("fetchUrl");
  const keys = createFlyKeyState();
  // Typing "wasd" (as in a URL) must not move the camera.
  for (const k of ["w", "a", "s", "d", "q", "e", "ArrowRight"]) {
    assertEquals(keys.press(k, input), false);
  }
  assertEquals(keys.size, 0);
});

Deno.test("release clears a key even when the keyup lands on an input", () => {
  const doc = fixture(`<canvas id="glCanvas"></canvas><input id="fetchUrl">`);
  const keys = createFlyKeyState();
  keys.press("w", doc.getElementById("glCanvas"));
  assert(keys.has("w"));
  // User clicks into the input while still holding W; keyup targets the input.
  keys.release("W");
  assert(
    !keys.has("w"),
    "Expected release to clear the key regardless of target",
  );
});

Deno.test("clear releases every held key (window blur / tab hidden)", () => {
  const doc = fixture(`<canvas id="glCanvas"></canvas>`);
  const canvas = doc.getElementById("glCanvas");
  const keys = createFlyKeyState();
  keys.press("w", canvas);
  keys.press("shift", canvas);
  keys.press("ArrowLeft", canvas);
  assertEquals(keys.size, 3);
  keys.clear();
  assertEquals(keys.size, 0);
  for (const k of ["w", "shift", "arrowleft"]) assert(!keys.has(k));
});

Deno.test("has normalises the queried key name", () => {
  const doc = fixture(`<canvas id="glCanvas"></canvas>`);
  const keys = createFlyKeyState();
  keys.press("ArrowUp", doc.getElementById("glCanvas"));
  assert(keys.has("arrowup"));
  assert(keys.has("ArrowUp"));
});

Deno.test("pressing the same key twice holds it once", () => {
  const doc = fixture(`<canvas id="glCanvas"></canvas>`);
  const canvas = doc.getElementById("glCanvas");
  const keys = createFlyKeyState();
  keys.press("w", canvas);
  keys.press("W", canvas);
  assertEquals(keys.size, 1);
});

Deno.test("press with a missing key name is ignored", () => {
  const doc = fixture(`<canvas id="glCanvas"></canvas>`);
  const keys = createFlyKeyState();
  assertEquals(keys.press(undefined, doc.getElementById("glCanvas")), false);
  assertEquals(keys.size, 0);
});
