## Summary

Refactored `docs/app.js` to import shared utility functions from
`docs/shared/snapshot_loader.js` instead of inlining duplicate copies. This
removes ~62 lines of duplicated code and ensures bug fixes in the shared module
automatically apply to all consumers. Closes #89.

### Functions replaced with imports

| Function                  | Lines removed | Notes                                     |
| ------------------------- | ------------- | ----------------------------------------- |
| `gunzipToText()`          | 25            | Identical to shared version               |
| `normaliseSnapshotUrl()`  | 14            | Identical to shared version               |
| `decodeBase64UrlToUtf8()` | 14            | Functionally identical to shared version  |
| `isDangerousUrlScheme()`  | 4             | Identical to shared version               |
| Inline file-reading logic | 7             | Replaced with `readSnapshotFile()` import |

The app-specific `fetchJson()` function (with PWA caching, CORS handling, and
fallback URL logic) remains in `app.js` as it contains behaviour beyond the
scope of the shared loader.

## Evidence

This is a pure refactoring with no visual or behavioural changes. The shared
module functions are already tested in `tests/snapshot_loader_test.ts`. All 65
existing tests continue to pass after the refactoring.

## Test Plan

- Added `tests/snapshot_loader_gunzip_test.ts` with tests for:
  - `gunzipToText()` — decompresses gzipped data correctly, rejects invalid data
  - `readSnapshotFile()` — parses plain JSON files, parses gzipped JSON files
- All 65 tests pass via `./quality.sh` (format + lint + test)
