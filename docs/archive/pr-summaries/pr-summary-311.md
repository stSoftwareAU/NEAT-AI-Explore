## Summary

Removed the magic-value CSS grep test from `tests/topo_modal_markup_test.ts`
(the *"styles.css: topology modal uses landscape sizing and full-viewport
backdrop"* test, formerly lines 64-89). Closes #311.

That test read `docs/styles.css` as text and asserted exact design-token values
copied from the current stylesheet:

- `aspect-ratio: 16 / 9`
- `width: min(90vw, 1400px)`
- `max-height: 80vh`
- backdrop `position: fixed`

These are presentation measurements with no spec or rationale attached — they
pin the numbers the CSS happens to contain today. A visual restyle (capping the
modal at `1300px`, relaxing `max-height` to `85vh`, or changing the aspect
ratio) changes none of the guarded contract yet breaks every assertion: the
hallmark of a HOW-test (anti-pattern 5, magic values) delivered through a
source-text grep (anti-pattern 2). CSS layout is browser-only and cannot be
exercised in a DOM-free Deno unit test, so per the project's own testing
guidelines (browser-only code is skipped, not faked) the grep was deleted
rather than rewritten into another grep. Modal dimension/backdrop layout
belongs in a rendered visual-regression or Playwright check.

This is resolution **(b)** from the issue — deleting a counter-productive
test is an explicitly acceptable outcome. The two markup-scaffold tests above
it assert real structural invariants of `docs/index.html` (the modal scaffold,
ARIA attributes, close button, title, body, backdrop element) and were kept
untouched. The now-unused `CSS_PATH` constant and `loadCss()` helper were
removed to keep the file lint-clean, and a comment documents why the third
test was removed.

## Evidence

Backend/test-only change — no web interface to screenshot. Verification is via
the test suite:

- `deno test -A tests/topo_modal_markup_test.ts` → `2 passed | 0 failed`
  (the two retained markup-scaffold tests).
- `./quality.sh` → `726 passed | 0 failed`, format and lint clean.

## Test Plan

- Modified `tests/topo_modal_markup_test.ts`:
  - Deleted the `styles.css` magic-value grep test.
  - Removed the unused `CSS_PATH` constant and `loadCss()` helper.
  - Added a comment explaining the removal (Issue #311).
- No business logic changed; the two structural HTML tests are unchanged and
  still pass.
