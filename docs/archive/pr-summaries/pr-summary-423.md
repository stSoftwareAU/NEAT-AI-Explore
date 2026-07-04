## Summary

Both `docs/graph/index.html` and `docs/starfield/index.html` render two
`<aside>` (complementary) landmarks: the Focus HUD (`#hud`) and the Legend
(`#legend`). The legend already carried `aria-label="Graph legend"`, but the HUD
had no accessible name — `aria-live="polite"` announces content changes but does
not name the landmark. A screen-reader user navigating by landmark therefore saw
two undistinguished "complementary" regions per page and could not tell the
Focus HUD from the Legend.

Added `aria-label="Focus details"` to each `#hud` aside so every `<aside>`
landmark now has a unique, non-empty accessible name. Closes #423.

```diff
-      <aside id="hud" class="hud" aria-live="polite">
+      <aside id="hud" class="hud" aria-live="polite" aria-label="Focus details">
```

## Evidence

This is a purely non-visual accessibility change — it adds an `aria-label`
attribute and does not alter rendered layout or styling, so there is no visual
diff to screenshot. Correctness is verified by the DOM-based tests below, which
parse the published HTML and assert the landmark contract.

```
running 4 tests from ./tests/hud_aside_label_test.ts
../docs/graph/index.html: #hud aside has a distinguishing aria-label ... ok
../docs/graph/index.html: every <aside> landmark has a unique non-empty aria-label ... ok
../docs/starfield/index.html: #hud aside has a distinguishing aria-label ... ok
../docs/starfield/index.html: every <aside> landmark has a unique non-empty aria-label ... ok
ok | 4 passed | 0 failed
```

Full quality gate (`./quality.sh`): `754 passed | 0 failed`.

## Test Plan

- Added `tests/hud_aside_label_test.ts`, which for both `docs/graph/index.html`
  and `docs/starfield/index.html`:
  - asserts the `<aside id="hud">` landmark carries
    `aria-label="Focus details"`;
  - asserts every `<aside>` landmark on the page has a unique, non-empty
    `aria-label` (mirrors the duplicate-`<nav>` regression test from #422).
- Confirmed the tests fail against the unfixed markup and pass after adding the
  `aria-label`.
