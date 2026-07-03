/**
 * Tests for Issue #419: the hand-authored evidence page served on GitHub Pages
 * must declare a complete document head.
 *
 * Unlike the three app-shell pages (covered by `csp_meta_test.ts` and
 * `pa11yci.json`), `docs/evidence/loading-fix-evidence.html` is not exercised
 * by CI's accessibility run. These tests pin the baseline head metadata so the
 * page cannot silently regress:
 *   - `<html lang="…">`  — WCAG 3.1.1 (screen readers, translation tools).
 *   - `<meta charset="utf-8">` — correct decoding of multi-byte UTF-8 glyphs.
 *   - `<meta name="viewport" …>` — readable rendering on phones.
 */

import { assert } from "./test_helpers.ts";

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  const root = here.replace(/\/tests\/evidence_head_metadata_test\.ts$/, "");
  return [root, ...parts].join("/");
}

const EVIDENCE_HTML = repoPath("docs", "evidence", "loading-fix-evidence.html");

Deno.test("evidence page declares a lang attribute on <html>", async () => {
  const html = await Deno.readTextFile(EVIDENCE_HTML);
  assert(
    /<html\s[^>]*\blang\s*=\s*"[^"]+"/i.test(html),
    "Expected <html> to declare a non-empty lang attribute (WCAG 3.1.1)",
  );
});

Deno.test('evidence page declares <meta charset="utf-8">', async () => {
  const html = await Deno.readTextFile(EVIDENCE_HTML);
  assert(
    /<meta\s+charset\s*=\s*"utf-8"\s*\/?>/i.test(html),
    'Expected <meta charset="utf-8"> in the document head',
  );
});

Deno.test("evidence page declares a responsive viewport meta", async () => {
  const html = await Deno.readTextFile(EVIDENCE_HTML);
  assert(
    /<meta\s+name\s*=\s*"viewport"\s+content\s*=\s*"[^"]*width=device-width[^"]*"\s*\/?>/i
      .test(html),
    'Expected <meta name="viewport" content="width=device-width, …">',
  );
});
