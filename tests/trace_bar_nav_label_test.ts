/**
 * Tests for Issue #422: duplicate `<nav>` landmarks must carry distinguishing
 * `aria-label`s.
 *
 * `docs/index.html` exposes two `<nav>` landmarks — the trace breadcrumb bar
 * (`.traceBar`) and the mobile bottom tab bar (`.mobileTabBar`). Screen-reader
 * users navigating by landmark see two "navigation" regions; without a unique
 * accessible name on each they cannot tell the breadcrumb from the mobile tab
 * bar. This test pins that every `<nav>` has a non-empty, unique `aria-label`.
 */

import { assertEquals } from "./test_helpers.ts";
import { loadIndexDocument } from "./dom_helpers.ts";

Deno.test("traceBar nav has a distinguishing aria-label", async () => {
  const doc = await loadIndexDocument();
  const traceBar = doc.querySelector("nav.traceBar");
  if (!traceBar) {
    throw new Error('docs/index.html must contain a <nav class="traceBar">');
  }
  const label = traceBar.getAttribute("aria-label");
  assertEquals(
    label,
    "Trace path",
    'trace breadcrumb <nav> must have aria-label="Trace path"',
  );
});

Deno.test("every <nav> landmark has a unique non-empty aria-label", async () => {
  const doc = await loadIndexDocument();
  const navs = Array.from(doc.querySelectorAll("nav"));
  if (navs.length < 2) {
    throw new Error(
      `expected at least 2 <nav> landmarks, found ${navs.length}`,
    );
  }
  const labels = navs.map((nav) => nav.getAttribute("aria-label"));
  for (const label of labels) {
    if (!label || label.trim() === "") {
      throw new Error("every <nav> landmark must have a non-empty aria-label");
    }
  }
  const unique = new Set(labels);
  assertEquals(
    unique.size,
    labels.length,
    "each <nav> landmark must have a distinct aria-label",
  );
});
