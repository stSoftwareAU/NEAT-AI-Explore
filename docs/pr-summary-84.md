## Summary

Audit and clean-up of all test cases per issue #84. Removed 61 "how" tests that
read source files as text and grepped for implementation patterns (e.g.
`Deno.readTextFile` + `.includes()`). These tests offered no real value — they
broke on any refactor and didn't verify correctness.

Retained 5 existing "what" test files that import modules, call functions with
test data, and assert results. Cleaned up `pwa_test.ts` to keep only the 3
legitimate tests (SemVer validation, file existence, manifest integrity) and
removed 4 grep-based tests from it.

Added 2 new "what" test files covering previously untested pure modules:

- `snapshot_loader_test.ts` — 14 tests for `normaliseSnapshotUrl`,
  `decodeBase64UrlToUtf8`, `isDangerousUrlScheme`
- `colour_maps_test.ts` — 13 tests for `hash32`, `u01ToSigned`, `u32ToU01`,
  `neuronColourRgb01`

Updated `README.md` with a new **Testing** section that documents:

- The distinction between unit tests and benchmarks
- The distinction between "what" tests and "how" tests (with examples)
- Which modules are testable in Deno and which are browser-only

### Before / after

| Metric            | Before | After |
| ----------------- | ------ | ----- |
| Test files        | 66     | 8     |
| "How" test files  | 61     | 0     |
| "What" test files | 5      | 8     |
| Total test cases  | ~120   | 44    |

Every remaining test imports a module, calls a function, and asserts a result.

## Evidence

Unable to generate screenshot: this change is a test audit with no UI changes.

## Test Plan

- Retained existing "what" tests (unchanged):
  - `tests/attribution_walk_test.ts`
  - `tests/impact_attribution_test.ts`
  - `tests/impact_diagnostics_test.ts`
  - `tests/inbound_allocation_test.ts`
  - `tests/input_usage_dashboard_test.ts`
- Cleaned up `tests/pwa_test.ts` (removed 4 grep-based tests, kept 3 legitimate
  tests)
- Added `tests/snapshot_loader_test.ts` (14 new tests)
- Added `tests/colour_maps_test.ts` (13 new tests)
- `./quality.sh` passes cleanly (format, lint, 44 tests)
