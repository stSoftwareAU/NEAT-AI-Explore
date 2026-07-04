/**
 * Tests for Issue #423: duplicate `<aside>` (complementary) landmarks must
 * carry distinguishing `aria-label`s.
 *
 * Both `docs/graph/index.html` and `docs/starfield/index.html` render two
 * `<aside>` landmarks — the Focus HUD (`#hud`) and the Legend (`#legend`). The
 * legend already carries `aria-label="Graph legend"`, but the HUD had no
 * accessible name, so a screen-reader user navigating by landmark saw two
 * undistinguished "complementary" regions per page. This test pins that the
 * HUD aside is named and that every `<aside>` has a unique non-empty label.
 */

import { assertEquals } from "./test_helpers.ts";
import { loadDocument } from "./dom_helpers.ts";

const PAGES = ["../docs/graph/index.html", "../docs/starfield/index.html"];

for (const page of PAGES) {
  Deno.test(`${page}: #hud aside has a distinguishing aria-label`, async () => {
    const doc = await loadDocument(new URL(page, import.meta.url));
    const hud = doc.querySelector("aside#hud");
    if (!hud) {
      throw new Error(`${page} must contain an <aside id="hud">`);
    }
    assertEquals(
      hud.getAttribute("aria-label"),
      "Focus details",
      '#hud aside must have aria-label="Focus details"',
    );
  });

  Deno.test(`${page}: every <aside> landmark has a unique non-empty aria-label`, async () => {
    const doc = await loadDocument(new URL(page, import.meta.url));
    const asides = Array.from(doc.querySelectorAll("aside"));
    if (asides.length < 2) {
      throw new Error(
        `${page} expected at least 2 <aside> landmarks, found ${asides.length}`,
      );
    }
    const labels = asides.map((aside) => aside.getAttribute("aria-label"));
    for (const label of labels) {
      if (!label || label.trim() === "") {
        throw new Error(
          "every <aside> landmark must have a non-empty aria-label",
        );
      }
    }
    const unique = new Set(labels);
    assertEquals(
      unique.size,
      labels.length,
      "each <aside> landmark must have a distinct aria-label",
    );
  });
}
