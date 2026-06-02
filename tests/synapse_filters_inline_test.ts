/**
 * Structural tests for the inline-filters layout (Issue #245).
 *
 * The "Inbound Synapses" panel previously hid Min alloc imp + Top K behind
 * a `<details><summary>Filters</summary>` block even when the row had room
 * to spare. The fix lifts the inputs out of `<details>` and renders them on
 * the same row as the heading and Sort select, collapsing them behind a
 * "Filters" popover button only when the row would overflow.
 *
 * These tests parse the published HTML into a DOM and guard the layout
 * invariants via semantic queries, so a behaviour-preserving refactor
 * (attribute reorder, class rename, swapping the collapse element) cannot
 * silently flag as a regression while a real regression still does
 * (Issue #312).
 */

import { assert, assertEquals } from "./test_helpers.ts";
import { loadIndexDocument } from "./dom_helpers.ts";

Deno.test(".synapseHeader carries data-filters-mode default (Issue #245)", async () => {
  const doc = await loadIndexDocument();
  // The attribute must be present in the static HTML so CSS can style the
  // default layout before JS runs (and so users with JS disabled still see
  // a sensible state).
  const header = doc.querySelector(".synapseHeader");
  assert(header, "Expected a .synapseHeader element");
  assertEquals(
    header.getAttribute("data-filters-mode"),
    "inline",
    'Expected .synapseHeader to declare data-filters-mode="inline" by default',
  );
});

Deno.test("filter inputs live inline, not inside a <details> wrapper (Issue #245)", async () => {
  const doc = await loadIndexDocument();
  // The Min-alloc and Top-K inputs must remain reachable by ID (existing JS
  // wires up listeners by ID).
  const minAlloc = doc.getElementById("synapseMinAlloc");
  const topK = doc.getElementById("synapseTopK");
  assert(minAlloc, "Expected #synapseMinAlloc input to remain");
  assert(topK, "Expected #synapseTopK select to remain");

  // Behavioural contract: the inputs must not sit inside a collapsible
  // <details> wrapper, so they render inline by default regardless of how
  // the collapse element is named or implemented.
  assertEquals(
    minAlloc.closest("details"),
    null,
    "Expected #synapseMinAlloc to render inline, not inside a <details> wrapper",
  );
  assertEquals(
    topK.closest("details"),
    null,
    "Expected #synapseTopK to render inline, not inside a <details> wrapper",
  );
});

Deno.test("a dedicated Filters toggle button exists for collapsed mode (Issue #245)", async () => {
  const doc = await loadIndexDocument();
  const toggle = doc.getElementById("synapseFiltersToggle");
  assert(
    toggle,
    "Expected a #synapseFiltersToggle button to drive the collapsed popover",
  );
  assertEquals(
    toggle.getAttribute("aria-controls"),
    "synapseFilterPanel",
    "Expected #synapseFiltersToggle to reference its popover via aria-controls",
  );
});

Deno.test("filter panel container is addressable for popover positioning (Issue #245)", async () => {
  const doc = await loadIndexDocument();
  assert(
    doc.getElementById("synapseFilterPanel"),
    'Expected the inline filter container to expose id="synapseFilterPanel"',
  );
});
