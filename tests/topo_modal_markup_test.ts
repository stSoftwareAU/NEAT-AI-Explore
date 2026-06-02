/**
 * Structural tests for the topology pop-out modal markup (Issue #241).
 *
 * The static HTML in `docs/index.html` must declare the modal scaffold so the
 * page renders the close button, title, backdrop, and body container without
 * any JS having run. The markup tests parse the HTML into a DOM and assert
 * the structural / accessibility contract via semantic queries, so attribute
 * reordering or class renames cannot flag a refactor as a regression
 * (Issue #312).
 */

import { assert, assertEquals } from "./test_helpers.ts";
import { loadDocument } from "./dom_helpers.ts";

const HTML_PATH = new URL("../docs/index.html", import.meta.url);

Deno.test("index.html: declares the topology pop-out modal scaffold (Issue #241)", async () => {
  const doc = await loadDocument(HTML_PATH);
  const modal = doc.getElementById("topoModal");
  assert(modal, "missing #topoModal");
  assertEquals(
    modal.getAttribute("role"),
    "dialog",
    '#topoModal must declare role="dialog"',
  );
  assertEquals(
    modal.getAttribute("aria-modal"),
    "true",
    '#topoModal must declare aria-modal="true"',
  );
  assertEquals(
    modal.getAttribute("aria-labelledby"),
    "topoModalTitle",
    "#topoModal must label itself via #topoModalTitle",
  );
  assert(
    modal.hasAttribute("hidden"),
    "#topoModal must default to the hidden state",
  );
});

Deno.test("index.html: modal contains close button, title, body, and backdrop (Issue #241)", async () => {
  const doc = await loadDocument(HTML_PATH);
  const close = doc.querySelector(".topoModalClose");
  assert(close, "missing .topoModalClose button");
  assertEquals(
    close.getAttribute("aria-label"),
    "Close",
    "close button must expose an aria-label",
  );
  assert(doc.getElementById("topoModalTitle"), "missing #topoModalTitle h2");
  assert(doc.getElementById("topoModalBody"), "missing #topoModalBody slot");
  assert(
    doc.querySelector(".topoModalBackdrop"),
    "missing .topoModalBackdrop element",
  );
});

// NOTE (Issue #311): The former third test in this file —
// "styles.css: topology modal uses landscape sizing and full-viewport backdrop" —
// was removed. It read `docs/styles.css` as text and grepped for exact design-token
// values (aspect-ratio 16/9, width min(90vw, 1400px), max-height 80vh, backdrop
// position: fixed). Those are presentation measurements with no spec attached: a
// visual restyle (e.g. capping width at 1300px or relaxing max-height to 85vh)
// would break the assertions without changing any guarded behaviour — the hallmark
// of a HOW-test. CSS layout is browser-only and cannot be meaningfully exercised in
// a DOM-free Deno unit test, so the grep was deleted rather than faked. Modal
// dimension/backdrop layout belongs in a rendered visual-regression or Playwright
// check. The two markup-scaffold tests above assert real structural invariants and
// remain.
