/**
 * Tests for Issue #420: the live status element on every app-shell HTML must
 * be announced to assistive tech.
 *
 * The `<span id="status" class="statusInline">` reports snapshot load
 * progress and errors. To give screen-reader users spoken feedback it must be
 * a live region — `role="status"` plus `aria-live="polite"`. `docs/index.html`
 * and `docs/graph/index.html` already carry these attributes;
 * `docs/starfield/index.html` was missing them, giving starfield users a
 * degraded, inconsistent experience. pa11y does not flag an absent live
 * region, so this test pins the contract across all three entry pages.
 */

import { assertEquals } from "./test_helpers.ts";
import { loadDocument } from "./dom_helpers.ts";

const ENTRY_HTMLS = [
  "docs/index.html",
  "docs/graph/index.html",
  "docs/starfield/index.html",
  "docs/dag/index.html",
  "docs/subgraph/index.html",
];

for (const rel of ENTRY_HTMLS) {
  Deno.test(`status region in ${rel} is an announced live region`, async () => {
    const doc = await loadDocument(new URL(`../${rel}`, import.meta.url));
    const status = doc.getElementById("status");
    if (!status) {
      throw new Error(`${rel} must contain an element with id="status"`);
    }
    assertEquals(
      status.getAttribute("role"),
      "status",
      `${rel} #status must have role="status" so it is announced to assistive tech`,
    );
    assertEquals(
      status.getAttribute("aria-live"),
      "polite",
      `${rel} #status must have aria-live="polite" for polite screen-reader announcements`,
    );
  });
}
