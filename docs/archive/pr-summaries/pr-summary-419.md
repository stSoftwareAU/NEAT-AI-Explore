## Summary

The hand-authored evidence page `docs/evidence/loading-fix-evidence.html`,
served on GitHub Pages alongside the rest of `docs/`, had an incomplete document
head: the `<html>` tag carried no `lang` attribute, the `<head>` declared no
`<meta charset="utf-8">`, and there was no `<meta name="viewport">`. The three
app-shell pages (`docs/index.html`, `docs/graph/index.html`,
`docs/starfield/index.html`) all declare these, but `pa11yci.json` only tests
`/`, `/graph/`, and `/starfield/`, so this page's defects slipped past CI.

Added the standard head metadata the sibling pages already use:

- `<html lang="en">` — screen readers and translation tools can determine the
  document language (WCAG 3.1.1).
- `<meta charset="utf-8" />` — the body's multi-byte UTF-8 glyphs (em-dash `—`,
  ellipsis `…`) decode correctly regardless of the server default.
- `<meta name="viewport" content="width=device-width, initial-scale=1" />` — the
  page renders readably on phones instead of zoomed-out.

Closes #419.

## Evidence

This is a document-head metadata change with no scripted behaviour to
screenshot; Playwright MCP was unavailable in this run. The fix is verified by
unit tests that read the committed HTML and assert on the three attributes.

Test output:

```
running 3 tests from ./tests/evidence_head_metadata_test.ts
evidence page declares a lang attribute on <html> ... ok
evidence page declares <meta charset="utf-8"> ... ok
evidence page declares a responsive viewport meta ... ok

ok | 3 passed | 0 failed
```

Full quality gate (`./quality.sh`): `743 passed | 0 failed`.

## Test Plan

- Added `tests/evidence_head_metadata_test.ts` with three tests, each written
  first and confirmed failing against the unfixed page, then passing after the
  fix:
  - `evidence page declares a lang attribute on <html>`
  - `evidence page declares <meta charset="utf-8">`
  - `evidence page declares a responsive viewport meta`
