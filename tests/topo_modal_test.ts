/**
 * Tests for the topology pop-out modal controller (Issue #241).
 *
 * The controller is a thin, DOM-agnostic wrapper that drives a click-to-pop-out
 * modal for the network-topology diagram. It is constructed with mock element
 * references so the behaviour can be exercised in Deno without a real browser.
 *
 * Acceptance coverage:
 *   - open() renders into the body, reveals the modal + backdrop, focuses the
 *     close button, installs a focus trap, and locks page scroll.
 *   - close() hides the modal + backdrop, removes the focus trap, restores
 *     focus to the element that opened the modal, and unlocks page scroll.
 *   - The close button, the backdrop, and the Escape key all trigger close.
 */

import { assert, assertEquals } from "./test_helpers.ts";
import { createTopoModalController } from "../docs/shared/topo_modal.js";

// ---------------------------------------------------------------------------
// Minimal DOM mocks. We only stub what the controller actually touches.
// ---------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
type AnyFn = (...args: any[]) => any;

class MockElement {
  hidden = true;
  innerHTML = "";
  attributes: Record<string, string> = {};
  listeners: Record<string, AnyFn[]> = {};
  focusCount = 0;
  style: Record<string, string> = {};
  ownerDocument: MockDocument | null = null;
  children: MockElement[] = [];
  matchesSelector: ((sel: string) => boolean) | null = null;

  constructor(public tag = "div") {}

  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
  }
  getAttribute(name: string) {
    return this.attributes[name];
  }
  addEventListener(name: string, fn: AnyFn) {
    (this.listeners[name] ??= []).push(fn);
  }
  removeEventListener(name: string, fn: AnyFn) {
    const arr = this.listeners[name];
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  }
  dispatch(name: string, ev: unknown) {
    for (const fn of this.listeners[name] ?? []) fn(ev);
  }
  focus() {
    this.focusCount += 1;
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }
  // The controller looks up child elements via querySelector(...). We back
  // that with a tiny registry the test sets up manually.
  querySelector(sel: string): MockElement | null {
    const child = this.children.find((c) =>
      c.matchesSelector ? c.matchesSelector(sel) : false
    );
    return child ?? null;
  }
  querySelectorAll(_sel: string): MockElement[] {
    // Used by modal_focus.getFocusableElements — we only need the close button
    // to be discoverable as a focusable element. Return all children that have
    // matchesSelector returning truthy for the focusable button case.
    return this.children.filter((c) => c.tag === "button");
  }
}

class MockDocument {
  activeElement: MockElement | null = null;
  documentElement = new MockElement("html");
  listeners: Record<string, AnyFn[]> = {};
  addEventListener(name: string, fn: AnyFn) {
    (this.listeners[name] ??= []).push(fn);
  }
  removeEventListener(name: string, fn: AnyFn) {
    const arr = this.listeners[name];
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  }
  dispatch(name: string, ev: unknown) {
    for (const fn of this.listeners[name] ?? []) fn(ev);
  }
}

interface Harness {
  modal: MockElement;
  backdrop: MockElement;
  closeBtn: MockElement;
  body: MockElement;
  doc: MockDocument;
  controller: ReturnType<typeof createTopoModalController>;
  renderCalls: MockElement[];
}

// deno-lint-ignore no-explicit-any
function buildHarness(extraOpts: Record<string, any> = {}): Harness {
  const doc = new MockDocument();
  const modal = new MockElement("div");
  modal.ownerDocument = doc;
  const backdrop = new MockElement("div");
  backdrop.matchesSelector = (s) => s === ".topoModalBackdrop";
  const closeBtn = new MockElement("button");
  closeBtn.matchesSelector = (s) => s === ".topoModalClose";
  const body = new MockElement("div");
  body.matchesSelector = (s) =>
    s === "#topoModalBody" || s === ".topoModalBody";
  modal.children = [closeBtn, body];
  // Backdrop sits as a sibling of the modal in the DOM, so the controller
  // accepts it as an explicit option rather than via querySelector.
  const renderCalls: MockElement[] = [];
  const controller = createTopoModalController({
    // deno-lint-ignore no-explicit-any
    modal: modal as any,
    // deno-lint-ignore no-explicit-any
    backdrop: backdrop as any,
    // deno-lint-ignore no-explicit-any
    doc: doc as any,
    render: (target: unknown) => {
      renderCalls.push(target as MockElement);
    },
    ...extraOpts,
  });
  return { modal, backdrop, closeBtn, body, doc, controller, renderCalls };
}

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

Deno.test("createTopoModalController.open: reveals modal, renders body, focuses close button", () => {
  const h = buildHarness();
  const trigger = new MockElement("button");
  // deno-lint-ignore no-explicit-any
  h.controller.open(trigger as any);

  assertEquals(h.modal.hidden, false, "modal should be visible");
  assertEquals(h.backdrop.hidden, false, "backdrop should be visible");
  assertEquals(h.modal.getAttribute("aria-hidden"), "false");
  assertEquals(h.renderCalls.length, 1, "render should run once");
  assertEquals(h.renderCalls[0], h.body, "render target should be the body");
  assert(h.closeBtn.focusCount > 0, "close button should receive focus");
  assertEquals(
    h.doc.documentElement.style.overflow,
    "hidden",
    "page scroll should be locked while modal is open",
  );
});

Deno.test("createTopoModalController.close: hides modal, restores focus to opener", () => {
  const h = buildHarness();
  const trigger = new MockElement("button");
  // deno-lint-ignore no-explicit-any
  h.controller.open(trigger as any);
  h.controller.close();

  assertEquals(h.modal.hidden, true, "modal should hide on close");
  assertEquals(h.backdrop.hidden, true, "backdrop should hide on close");
  assertEquals(h.modal.getAttribute("aria-hidden"), "true");
  assert(trigger.focusCount > 0, "focus should return to the opener");
  assertEquals(
    h.doc.documentElement.style.overflow,
    "",
    "page scroll should be restored on close",
  );
});

Deno.test("createTopoModalController: clicking the backdrop closes the modal", () => {
  const h = buildHarness();
  const trigger = new MockElement("button");
  // deno-lint-ignore no-explicit-any
  h.controller.open(trigger as any);
  h.backdrop.dispatch("click", {});
  assertEquals(h.modal.hidden, true, "backdrop click should close the modal");
});

Deno.test("createTopoModalController: clicking the close button closes the modal", () => {
  const h = buildHarness();
  const trigger = new MockElement("button");
  // deno-lint-ignore no-explicit-any
  h.controller.open(trigger as any);
  h.closeBtn.dispatch("click", {});
  assertEquals(
    h.modal.hidden,
    true,
    "close-button click should close the modal",
  );
});

Deno.test("createTopoModalController: Escape on document closes the modal", () => {
  const h = buildHarness();
  const trigger = new MockElement("button");
  // deno-lint-ignore no-explicit-any
  h.controller.open(trigger as any);
  h.doc.dispatch("keydown", { key: "Escape" });
  assertEquals(h.modal.hidden, true, "Escape should close the modal");
});

Deno.test("createTopoModalController: keys other than Escape do nothing", () => {
  const h = buildHarness();
  const trigger = new MockElement("button");
  // deno-lint-ignore no-explicit-any
  h.controller.open(trigger as any);
  h.doc.dispatch("keydown", { key: "Enter" });
  assertEquals(h.modal.hidden, false, "Enter should not close the modal");
});

Deno.test("createTopoModalController.close: no-op when already closed", () => {
  const h = buildHarness();
  // No open() — close() should be safe to call.
  h.controller.close();
  assertEquals(h.modal.hidden, true);
});

Deno.test("createTopoModalController: focus trap is engaged on open, released on close", () => {
  // Assert the observable contract via the injectable installFocusTrap seam:
  // open() engages the trap exactly once and close() releases it. This stays
  // green regardless of *how* installFocusTrap traps focus (keydown listener,
  // focusin, inert attribute, ...). The trapping behaviour itself is covered
  // behaviourally in tests/modal_focus_test.ts.
  let installs = 0;
  let cleanups = 0;
  const h = buildHarness({
    installFocusTrap: () => {
      installs += 1;
      return () => {
        cleanups += 1;
      };
    },
  });
  const trigger = new MockElement("button");
  // deno-lint-ignore no-explicit-any
  h.controller.open(trigger as any);
  assertEquals(installs, 1, "open() should engage the focus trap once");
  assertEquals(cleanups, 0, "open() should not release the focus trap");
  h.controller.close();
  assertEquals(cleanups, 1, "close() should release the focus trap");
  assertEquals(installs, 1, "close() should not re-engage the focus trap");
});

Deno.test("createTopoModalController.isOpen reflects modal state", () => {
  const h = buildHarness();
  assertEquals(h.controller.isOpen(), false);
  const trigger = new MockElement("button");
  // deno-lint-ignore no-explicit-any
  h.controller.open(trigger as any);
  assertEquals(h.controller.isOpen(), true);
  h.controller.close();
  assertEquals(h.controller.isOpen(), false);
});
