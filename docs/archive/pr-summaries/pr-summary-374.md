## Summary

Added behavioural tests for the previously untested public function
`initThemeMode` in `docs/shared/theme.js` (Issue #374). The function's pure
helpers (`normaliseThemeMode`, `themeModeLabel`, `themeModeGlyph`,
`cycleThemeMode`) were already covered by `tests/theme_test.ts`, but the
stateful DOM wiring — id resolution, the persistence gate, the button-wiring
loop, click cycling, and the OS `prefers-color-scheme` subscription — was only
exercised incidentally by the `docs/app.js` smoke test, which tolerates runtime
errors and asserts nothing about behaviour. This PR closes that coverage gap.

No production code changed — this is a test-only addition. Closes #374.

## Evidence

This is a test-only change to a browser module; there is no new UI to
screenshot. Verification is the new behavioural suite, which exercises the real
exported `initThemeMode` against a `@b-fuze/deno-dom` document plus small,
controllable stubs for the globals it touches (`document`, `window.matchMedia`,
`localStorage`) and asserts on observable DOM/state (button glyph, `title`,
`aria-label`, the root `data-theme` attribute, and the `theme-color` meta) —
never on which private helper ran (Issue #312).

The tests are genuine: they failed before two real stubbing fixes were applied
(Deno's `localStorage` getter/setter ignores plain assignment, so it must be
swapped via its property descriptor; deno-dom stores `.title` as a property
without reflecting it to the attribute), confirming they assert real behaviour
rather than passing trivially.

```mermaid
flowchart TD
  A[initThemeMode opts] --> B{resolve toggle ids}
  B -->|none found| Z[no-op, return]
  B -->|button(s) found| C{canUseLocalStorage?}
  C -->|yes| D[read saved mode]
  C -->|no| E[fall back to auto]
  D --> F[applyThemeMode]
  E --> F
  F --> G[updateButtons: glyph / title / aria-label]
  G --> H[wire click - cycle theme]
  H --> I[subscribe to OS prefers-color-scheme]
  I --> J{mode === auto?}
  J -->|yes| K[refresh theme-color on OS change]
  J -->|no| L[ignore OS change]
```

## Test Plan

New file `tests/theme_init_test.ts` adds seven behavioural tests for
`initThemeMode`:

- applies the saved mode on init and labels the button (glyph / `title` /
  `aria-label`, root `data-theme`, `theme-color` meta);
- cycles the theme on click (auto → light → dark → auto) and updates the button
  and persists the new mode;
- falls back to `auto` without throwing when `localStorage` is unavailable;
- is a no-op when no toggle button exists;
- wires every configured toggle button (a click on one refreshes all);
- keeps Auto mode in sync with OS `prefers-color-scheme` changes;
- ignores OS changes once an explicit mode is chosen.

All seven pass; the full `./quality.sh` gate (fmt, lint, type check, 770 tests)
passes cleanly.
