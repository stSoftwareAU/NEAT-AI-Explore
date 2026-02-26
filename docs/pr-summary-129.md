## Summary

Add starfield view to the service worker's static file cache and fix PWA
manifest icon purpose values. Closes #129.

### Service worker — starfield caching

- Added `./starfield/index.html`, `./starfield/starfield.js`, and
  `./starfield/starfield.css` to `STATIC_FILES` in `docs/sw.js`
- Added a navigation handler for `/starfield/` URLs (matching the existing
  `isGraphNav` pattern) so offline navigation serves the cached starfield shell

### Manifest icons

- Changed icon purpose from `"any maskable"` to `"any"` — the combined value is
  not best practice and no dedicated maskable icons exist yet

### Test updates

- `tests/pwa_test.ts`: added starfield files to the PWA file existence check,
  added tests for SW static file inclusion and starfield navigation handling,
  added test verifying manifest icons use single-purpose values
- `tests/lint_coverage_test.ts`: added `docs/starfield/starfield.js` to expected
  lint exclusions (DOM-dependent)

## Evidence

No UI changes — this is a caching/manifest configuration fix. Verified via tests
that confirm the starfield files are referenced in the service worker and
manifest icons have correct purpose values.

## Test Plan

- `tests/pwa_test.ts` — "docs PWA files exist" now includes starfield files
- `tests/pwa_test.ts` — "service worker caches starfield files" verifies SW
  includes all three starfield paths
- `tests/pwa_test.ts` — "service worker handles starfield navigation" verifies
  the SW recognises starfield URLs
- `tests/pwa_test.ts` — "manifest icons use single-purpose values" verifies each
  icon has exactly one purpose value
- `tests/lint_coverage_test.ts` — verifies `starfield.js` is in lint exclusions
- All 305 tests pass, `./quality.sh` passes cleanly
