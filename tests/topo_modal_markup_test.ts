/**
 * Structural tests for the topology pop-out modal markup (Issue #241).
 *
 * The static HTML in `docs/index.html` must declare the modal scaffold so the
 * page renders the close button, title, backdrop, and body container without
 * any JS having run. These tests guard those invariants.
 */

import { assert } from "./test_helpers.ts";

const HTML_PATH = new URL("../docs/index.html", import.meta.url);
const CSS_PATH = new URL("../docs/styles.css", import.meta.url);

async function loadHtml(): Promise<string> {
  return await Deno.readTextFile(HTML_PATH);
}
async function loadCss(): Promise<string> {
  return await Deno.readTextFile(CSS_PATH);
}

Deno.test("index.html: declares the topology pop-out modal scaffold (Issue #241)", async () => {
  const html = await loadHtml();
  assert(html.includes('id="topoModal"'), "missing #topoModal");
  assert(
    /id="topoModal"[^>]*role="dialog"/.test(html) ||
      /role="dialog"[^>]*id="topoModal"/.test(html),
    '#topoModal must declare role="dialog"',
  );
  assert(
    /id="topoModal"[^>]*aria-modal="true"/.test(html) ||
      /aria-modal="true"[^>]*id="topoModal"/.test(html),
    '#topoModal must declare aria-modal="true"',
  );
  assert(
    /id="topoModal"[^>]*aria-labelledby="topoModalTitle"/.test(html) ||
      /aria-labelledby="topoModalTitle"[^>]*id="topoModal"/.test(html),
    "#topoModal must label itself via #topoModalTitle",
  );
  assert(
    /id="topoModal"[^>]*\bhidden\b/.test(html),
    "#topoModal must default to the hidden state",
  );
});

Deno.test("index.html: modal contains close button, title, body, and backdrop (Issue #241)", async () => {
  const html = await loadHtml();
  assert(
    html.includes('class="topoModalClose"') ||
      /class="[^"]*\btopoModalClose\b/.test(html),
    "missing .topoModalClose button",
  );
  assert(
    /aria-label="Close"/.test(html),
    "close button must expose an aria-label",
  );
  assert(html.includes('id="topoModalTitle"'), "missing #topoModalTitle h2");
  assert(html.includes('id="topoModalBody"'), "missing #topoModalBody slot");
  assert(
    /class="[^"]*\btopoModalBackdrop\b/.test(html),
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
