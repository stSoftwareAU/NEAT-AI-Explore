## Summary

Extract `DEFAULT_SNAPSHOT_URL` and `SNAPSHOT_FALLBACK_URLS` into a shared config
module (`docs/shared/config.js`) and import from both `app.js` and `graph.js`.
Add fallback URL support to the graph explorer so it has the same resilient
loading behaviour as the trace explorer when GitHub Pages is blocked by CORS.
Closes #93.

## Changes

- **New**: `docs/shared/config.js` — single source of truth for snapshot URL
  constants (DOM-free, lintable, testable)
- **Updated**: `docs/app.js` — imports `DEFAULT_SNAPSHOT_URL` and
  `SNAPSHOT_FALLBACK_URLS` from shared config instead of defining them inline
- **Updated**: `docs/graph/graph.js` — imports from shared config and adds
  fallback URL logic to `loadSnapshotFromUrl` (mirrors `app.js` behaviour)
- **Updated**: `tests/lint_coverage_test.ts` — includes `config.js` in shared
  module lint coverage
- **Updated**: `README.md` — adds `docs/shared/config.js` to the testable
  modules table

## Evidence

This is a non-UI refactoring change (no visual changes). All quality checks pass:

- Format: 47 files checked
- Lint: 22 files checked
- Tests: 107 passed, 0 failed

## Test Plan

- Added `tests/config_test.ts` with 8 tests verifying:
  - `DEFAULT_SNAPSHOT_URL` is a valid HTTPS URL pointing to the snapshot repo
  - `SNAPSHOT_FALLBACK_URLS` is a non-empty array of strings
  - Fallback list does not redundantly include the default URL
  - At least one `raw.githubusercontent.com` fallback exists
  - At least one same-origin (relative path) fallback exists
- Updated `tests/lint_coverage_test.ts` to verify `config.js` is covered by
  `deno lint`
