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
const CSS_PATH = new URL("../docs/styles.css", import.meta.url);

async function loadCss(): Promise<string> {
  return await Deno.readTextFile(CSS_PATH);
}

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

Deno.test("styles.css: topology modal uses landscape sizing and full-viewport backdrop (Issue #241)", async () => {
  const css = await loadCss();
  // Landscape sizing: 16/9 aspect ratio, capped width and height.
  assert(/\.topoModal\b/.test(css), "missing .topoModal selector");
  assert(
    /aspect-ratio:\s*16\s*\/\s*9/.test(css),
    "expected landscape (16/9) aspect-ratio on the modal",
  );
  assert(
    /width:\s*min\(\s*90vw\s*,\s*1400px\s*\)/.test(css),
    "expected width: min(90vw, 1400px) on the modal",
  );
  assert(
    /max-height:\s*80vh/.test(css),
    "expected max-height: 80vh on the modal",
  );
  // Backdrop full-viewport.
  assert(
    /\.topoModalBackdrop\b/.test(css),
    "missing .topoModalBackdrop selector",
  );
  assert(
    /\.topoModalBackdrop[^{]*\{[^}]*position:\s*fixed/.test(css),
    "backdrop must be position: fixed",
  );
});
