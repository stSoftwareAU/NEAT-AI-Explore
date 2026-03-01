/**
 * Tests for docs/shared/modal_focus.js — pure focus-management helpers.
 *
 * Browser-dependent behaviour (DOM queries, installFocusTrap) cannot be fully
 * exercised in Deno. We test edge cases and exports that work without a real DOM.
 */

import { assert, assertEquals } from "./test_helpers.ts";
import {
  FOCUSABLE_SELECTOR,
  getFocusableElements,
  getInitialFocusTarget,
  installFocusTrap,
} from "../docs/shared/modal_focus.js";

Deno.test("FOCUSABLE_SELECTOR includes all expected interactive element selectors", () => {
  const expected = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    '[tabindex]:not([tabindex="-1"])',
  ];
  for (const s of expected) {
    assert(
      FOCUSABLE_SELECTOR.includes(s),
      `Expected FOCUSABLE_SELECTOR to include "${s}"`,
    );
  }
});

Deno.test("getFocusableElements returns empty array for null", () => {
  const result = getFocusableElements(null);
  assert(Array.isArray(result), "Expected an array");
  assertEquals(result.length, 0);
});

Deno.test("getFocusableElements returns empty array for undefined", () => {
  // deno-lint-ignore no-explicit-any
  const result = getFocusableElements(undefined as any);
  assert(Array.isArray(result), "Expected an array");
  assertEquals(result.length, 0);
});

Deno.test("getFocusableElements returns empty array for object without querySelectorAll", () => {
  // deno-lint-ignore no-explicit-any
  const result = getFocusableElements({} as any);
  assert(Array.isArray(result), "Expected an array");
  assertEquals(result.length, 0);
});

Deno.test("getInitialFocusTarget returns null for null", () => {
  assertEquals(getInitialFocusTarget(null), null);
});

Deno.test("getInitialFocusTarget returns null for undefined", () => {
  // deno-lint-ignore no-explicit-any
  assertEquals(getInitialFocusTarget(undefined as any), null);
});

Deno.test("installFocusTrap returns no-op cleanup for null container", () => {
  const cleanup = installFocusTrap(null);
  assertEquals(typeof cleanup, "function");
  cleanup();
});

Deno.test("installFocusTrap returns no-op cleanup for undefined container", () => {
  // deno-lint-ignore no-explicit-any
  const cleanup = installFocusTrap(undefined as any);
  assertEquals(typeof cleanup, "function");
  cleanup();
});

Deno.test("getFocusableElements works with a mock container", () => {
  const mockBtn = { tagName: "BUTTON" };
  const mockContainer = {
    querySelectorAll: (_sel: string) => [mockBtn],
  };
  // deno-lint-ignore no-explicit-any
  const result = getFocusableElements(mockContainer as any);
  assertEquals(result.length, 1);
  assertEquals(result[0], mockBtn);
});

Deno.test("getInitialFocusTarget returns first focusable element from mock", () => {
  const mockClose = { tagName: "BUTTON", id: "close" };
  const mockMore = { tagName: "BUTTON", id: "more" };
  const mockContainer = {
    querySelectorAll: (_sel: string) => [mockClose, mockMore],
  };
  // deno-lint-ignore no-explicit-any
  const target = getInitialFocusTarget(mockContainer as any);
  assertEquals(target, mockClose);
});

Deno.test("getInitialFocusTarget returns null when container has no focusable children", () => {
  const mockContainer = {
    querySelectorAll: (_sel: string) => [],
  };
  // deno-lint-ignore no-explicit-any
  const target = getInitialFocusTarget(mockContainer as any);
  assertEquals(target, null);
});
