## Summary

Add starfield view to the service worker cache and fix PWA manifest icon purpose
values. Closes #129.

### Changes

1. **Service worker — starfield caching** (`docs/sw.js`):
   - Added `./starfield/index.html`, `./starfield/starfield.js`, and
     `./starfield/starfield.css` to the `STATIC_FILES` array so the starfield
     view is precached and available offline.
   - Added a navigation handler for starfield URLs (matching the existing
     `isGraphNav` pattern) so navigating to `/starfield/` offline serves the
     cached starfield shell.

2. **Manifest icons** (`docs/manifest.webmanifest`):
   - Changed all icon entries from `"purpose": "any maskable"` to
     `"purpose": "any"`. The combined value is not best practice; since no
     dedicated maskable icons exist, `"any"` is the safer default.

3. **Test updates**:
   - Updated `tests/pwa_test.ts` to verify starfield files exist on disk, are
     referenced in `sw.js` STATIC_FILES, that a starfield navigation handler
     exists, and that manifest icons use single-purpose values.
   - Updated `tests/lint_coverage_test.ts` to include `starfield.js` in the
     expected lint exclusions list.

## Evidence

![Starfield view loads in browser](docs/evidence/starfield-view.png)

The starfield page loads correctly (WebGL warning is expected in headless
Chrome). The HTML shell, CSS, and JS are all served and cached by the service
worker.

## Test Plan

- Added `sw.js STATIC_FILES includes starfield assets` test in
  `tests/pwa_test.ts`
- Added `sw.js has starfield navigation handler` test in `tests/pwa_test.ts`
- Added `manifest icons use single-purpose values` test in `tests/pwa_test.ts`
- Updated `docs PWA files exist` test to include starfield files
- Updated `deno lint configuration excludes DOM-dependent files` test to include
  `docs/starfield/starfield.js`
- All 305 tests pass, `./quality.sh` clean
