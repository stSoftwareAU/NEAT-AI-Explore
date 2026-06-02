/**
 * Structural tests for the topology pop-out modal markup (Issue #241).
 *
 * The static HTML in `docs/index.html` must declare the modal scaffold so the
 * page renders the close button, title, backdrop, and body container without
 * any JS having run. These tests guard those invariants.
 */

import { assert } from "./test_helpers.ts";

const HTML_PATH = new URL("../docs/index.html", import.meta.url);

async function loadHtml(): Promise<string> {
  return await Deno.readTextFile(HTML_PATH);
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
