## Summary

Created 7 improvement suggestion issues via GH CLI and implemented 4 concrete
code quality improvements:

### Improvement issues created

1. **#87** — Add CI workflow to run quality gate on PRs
2. **#88** — Eliminate duplication between root and docs/ copies of impact
   modules
3. **#89** — Refactor app.js to import from shared modules instead of inlining
   duplicates
4. **#90** — Extract shared test assertion helpers to reduce duplication across
   test files
5. **#91** — Narrow deno.json lint exclusion to allow linting of shared modules
6. **#92** — Name magic constants in impact_diagnostics.js for readability
7. **#93** — Add snapshot fallback URLs to graph explorer for feature parity

### Improvements implemented in this PR

1. **Extracted shared test assertion helpers** (`tests/test_helpers.ts`) —
   replaced 5 different duplicated assertion variants across 8 test files with a
   single shared module exporting `assert`, `assertEquals`, and `approx`.

2. **Named magic constants in `impact_diagnostics.js`** — extracted 8 unnamed
   numeric literals into named constants (`NEAR_ZERO_THRESHOLD`, `SELU_LAMBDA`,
   `SELU_ALPHA`, `GELU_APPROX_COEFF`, `LEAKY_RELU_SLOPE`, `ELU_ALPHA`,
   `EXP_CLAMP_MAX`, `GAUSSIAN_CLAMP_MAX`).

3. **Narrowed `deno.json` lint exclusion** — changed from blanket `docs/**`
   exclusion to targeted exclusions for DOM/WebGL-dependent files only. This
   enabled linting of `docs/shared/` modules and uncovered 2 lint issues that
   were fixed (`prefer-const` in `graph_analysis.js`, unused variable in
   `snapshot_loader.js`).

4. **Added 17 new tests** (44 → 61 total):
   - 4 edge case tests for `computeImpactBreakdownToOutputs` (null input,
     start-is-output, truncation, collectPaths)
   - 11 derivative correctness tests for squash functions (LOGISTIC, IDENTITY,
     RELU, SELU, GELU, SOFTPLUS, SOFTSIGN, GAUSSIAN, ELU, MISH, COSINE)
   - 1 test for `summariseSeriesStats` with empty/non-finite values
   - 1 test for `summariseDeadZoneStats` with RELU6

## Evidence

This PR contains no UI changes. All changes are backend code quality
improvements verified by the test suite. The quality gate (`./quality.sh`)
passes cleanly:

```
==> Format (check)
Checked 35 files

==> Lint
Checked 18 files

==> Tests
ok | 61 passed | 0 failed
```

## Test Plan

- All 44 existing tests continue to pass (no tests removed or modified in logic)
- 17 new tests added across 2 test files:
  - `tests/impact_attribution_test.ts` — 4 new edge case tests
  - `tests/impact_diagnostics_test.ts` — 13 new derivative and stats tests
- New shared helper module: `tests/test_helpers.ts`
- Full quality gate (`./quality.sh`) passes: format, lint, and all 61 tests
