## Summary

Unify theme handling so the trace explorer respects `prefers-color-scheme`
and stored user preference instead of hard-locking dark mode. Closes #128.

### Changes

- **`docs/app.js`**: Removed the local `initThemeMode()` that forced
  `data-theme="dark"`. Now imports and calls `initThemeMode` from the shared
  `docs/shared/theme.js` module, which supports auto/light/dark with
  localStorage persistence.
- **`docs/index.html`**: Added a `#themeToggle` button (matching the existing
  `.themeToggle` CSS class) to the header so users can cycle through
  Auto / Light / Dark.
- **`docs/shared/theme.js`**: Exported the pure helper functions
  (`normaliseThemeMode`, `cycleThemeMode`, `themeModeLabel`, `themeModeGlyph`)
  so they can be unit-tested in Deno.
- **`README.md`**: Added `docs/shared/theme.js` to the testable-modules table.

## Evidence

### Dark mode (OS preference or user-selected)

![Trace explorer dark theme](docs/evidence/trace-dark-theme.png)

### Light mode (OS preference or user-selected)

![Trace explorer light theme](docs/evidence/trace-light-theme.png)

## Test Plan

- Added `tests/theme_test.ts` with 5 tests covering `normaliseThemeMode`,
  `cycleThemeMode`, `themeModeLabel`, and `themeModeGlyph`.
- All 310 tests pass (`./quality.sh` clean).
