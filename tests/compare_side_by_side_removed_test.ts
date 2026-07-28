/**
 * Regression test for Issue #554 — "Remove the compare page's side-by-side
 * iframe mode".
 *
 * The `/compare/` page (Issue #528) shipped a "Compare side by side" mode that
 * embedded all three candidate views as heavy `<iframe>`s loading the full
 * snapshot at once. On phones the page could render blank/frozen. The candidate
 * evaluation is complete (recorded in
 * `docs/archive/candidate-view-evaluation-528.md`), so the side-by-side mode is
 * removed while the compare page and its launcher cards stay.
 *
 * These tests parse the published `docs/compare/index.html` into a DOM and
 * assert the structural invariants of the removal via semantic queries, so
 * reordering attributes or renaming unrelated classes cannot flag a refactor as
 * a regression (Issue #312).
 */

import { assert, assertEquals } from "./test_helpers.ts";
import { loadDocument } from "./dom_helpers.ts";

function loadCompareDocument() {
  return loadDocument(new URL("../docs/compare/index.html", import.meta.url));
}

Deno.test("compare page keeps the launcher cards container (Issue #554)", async () => {
  const doc = await loadCompareDocument();
  assert(
    doc.getElementById("cards"),
    "The #cards launcher list must remain — the compare page keeps its cards.",
  );
});

Deno.test("compare page no longer ships the side-by-side button (Issue #554)", async () => {
  const doc = await loadCompareDocument();
  assertEquals(
    doc.getElementById("sideBySideBtn"),
    null,
    "Found stale #sideBySideBtn — the side-by-side toggle must be removed.",
  );
});

Deno.test("compare page no longer ships the side-by-side iframe section (Issue #554)", async () => {
  const doc = await loadCompareDocument();
  assertEquals(
    doc.getElementById("sideBySide"),
    null,
    "Found stale #sideBySide section — the iframe container must be removed.",
  );
});

Deno.test("compare page ships no side-by-side controls or iframes (Issue #554)", async () => {
  const doc = await loadCompareDocument();
  assertEquals(
    doc.querySelectorAll(".sideBySideControls").length,
    0,
    "Found stale .sideBySideControls — the controls row must be removed.",
  );
  assertEquals(
    doc.querySelectorAll("iframe").length,
    0,
    "The compare page must not embed any <iframe> once side-by-side is gone.",
  );
});

Deno.test("compare stylesheet drops the side-by-side rules (Issue #554)", async () => {
  const css = await Deno.readTextFile(
    new URL("../docs/compare/compare.css", import.meta.url),
  );
  for (const selector of [".sideBySide", ".frameCard", ".frameTitle"]) {
    assertEquals(
      css.includes(selector),
      false,
      `compare.css still defines ${selector} — dead side-by-side styling.`,
    );
  }
});
