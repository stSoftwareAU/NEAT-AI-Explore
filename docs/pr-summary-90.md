## Summary

Add tests for shared test assertion helpers and replace remaining manual
tolerance checks with `approx()`. Closes #90.

The shared `tests/test_helpers.ts` module (with `assert`, `assertEquals`, and
`approx`) was already extracted and adopted by all 8 test files. This PR
completes the effort by:

1. Adding comprehensive tests for the helpers themselves
   (`tests/test_helpers_test.ts`) — verifying truthy/falsy behaviour, equality
   semantics, tolerance boundaries, custom tolerances, and error messages.
2. Replacing 4 remaining manual `Math.abs(...)` tolerance checks in
   `impact_attribution_test.ts` with the shared `approx()` helper, eliminating
   the last pocket of duplicated assertion logic.

## Evidence

This is a purely backend/test change with no visual output. All 77 tests pass
and the full quality gate (`./quality.sh`) completes cleanly.

## Test Plan

- Added `tests/test_helpers_test.ts` with 12 tests covering `assert`,
  `assertEquals`, and `approx` (pass/fail paths, default/custom messages,
  default/custom tolerances)
- Updated `tests/impact_attribution_test.ts` to use `approx()` instead of
  manual `Math.abs` comparisons (no behaviour change, same tolerance)
- Full suite: 77 tests pass, 0 failures
