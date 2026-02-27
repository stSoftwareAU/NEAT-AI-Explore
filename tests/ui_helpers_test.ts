/**
 * Tests for docs/shared/ui_helpers.js (Issue #125).
 *
 * Covers escapeHtml — the only pure, DOM-free function extracted to ui_helpers.
 */

import { assertEquals } from "./test_helpers.ts";
import { escapeHtml } from "../docs/shared/ui_helpers.js";

// ---------------------------------------------------------------------------
// escapeHtml
// ---------------------------------------------------------------------------

Deno.test("escapeHtml – escapes ampersand", () => {
  assertEquals(escapeHtml("a&b"), "a&amp;b");
});

Deno.test("escapeHtml – escapes angle brackets", () => {
  assertEquals(escapeHtml("<div>"), "&lt;div&gt;");
});

Deno.test("escapeHtml – escapes double quotes", () => {
  assertEquals(escapeHtml('a"b'), "a&quot;b");
});

Deno.test("escapeHtml – escapes single quotes", () => {
  assertEquals(escapeHtml("a'b"), "a&#39;b");
});

Deno.test("escapeHtml – handles all entities together", () => {
  assertEquals(
    escapeHtml(`<a href="x" class='y'>&`),
    "&lt;a href=&quot;x&quot; class=&#39;y&#39;&gt;&amp;",
  );
});

Deno.test("escapeHtml – coerces non-string input to string", () => {
  assertEquals(escapeHtml(42), "42");
  assertEquals(escapeHtml(null), "null");
  assertEquals(escapeHtml(undefined), "undefined");
});

Deno.test("escapeHtml – returns empty string unchanged", () => {
  assertEquals(escapeHtml(""), "");
});

Deno.test("escapeHtml – leaves safe strings unchanged", () => {
  assertEquals(escapeHtml("hello world"), "hello world");
});
