/**
 * Structural tests for the inline-filters layout (Issue #245).
 *
 * The "Inbound Synapses" panel previously hid Min alloc imp + Top K behind
 * a `<details><summary>Filters</summary>` block even when the row had room
 * to spare. The fix lifts the inputs out of `<details>` and renders them on
 * the same row as the heading and Sort select, collapsing them behind a
 * "Filters" popover button only when the row would overflow.
 *
 * These tests guard the HTML invariants that the layout depends on so a
 * future refactor cannot silently regress the inline behaviour.
 */

import { assert } from "./test_helpers.ts";

const HTML_PATH = new URL("../docs/index.html", import.meta.url);

async function loadHtml(): Promise<string> {
  return await Deno.readTextFile(HTML_PATH);
}

Deno.test(".synapseHeader carries data-filters-mode default (Issue #245)", async () => {
  const html = await loadHtml();
  // The attribute must be present in the static HTML so CSS can style the
  // default layout before JS runs (and so users with JS disabled still see
  // a sensible state).
  assert(
    /class="synapseHeader"[^>]*data-filters-mode="inline"/.test(html) ||
      /data-filters-mode="inline"[^>]*class="synapseHeader"/.test(html),
    'Expected .synapseHeader to declare data-filters-mode="inline" by default',
  );
});

Deno.test("filter inputs live inline, not inside a <details> wrapper (Issue #245)", async () => {
  const html = await loadHtml();
  // The Min-alloc and Top-K inputs must keep their IDs (existing JS wires
  // up listeners by ID) but must no longer be wrapped by <details>.
  assert(
    html.includes('id="synapseMinAlloc"'),
    "Expected #synapseMinAlloc input to remain",
  );
  assert(
    html.includes('id="synapseTopK"'),
    "Expected #synapseTopK select to remain",
  );

  // No more <details class="filterDetails">…</details> wrapper.
  assert(
    !/<details\b[^>]*\bfilterDetails\b/.test(html),
    'Expected the <details class="filterDetails"> wrapper to be removed',
  );
});

Deno.test("a dedicated Filters toggle button exists for collapsed mode (Issue #245)", async () => {
  const html = await loadHtml();
  assert(
    html.includes('id="synapseFiltersToggle"'),
    "Expected a #synapseFiltersToggle button to drive the collapsed popover",
  );
  assert(
    /id="synapseFiltersToggle"[^>]*aria-controls="synapseFilterPanel"/.test(
      html,
    ),
    "Expected #synapseFiltersToggle to reference its popover via aria-controls",
  );
});

Deno.test("filter panel container is addressable for popover positioning (Issue #245)", async () => {
  const html = await loadHtml();
  assert(
    html.includes('id="synapseFilterPanel"'),
    'Expected the inline filter container to expose id="synapseFilterPanel"',
  );
});
