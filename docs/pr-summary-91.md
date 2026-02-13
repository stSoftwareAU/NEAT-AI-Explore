## Summary

The `deno.json` lint exclusion was already narrowed from the blanket `docs/**`
to targeted exclusions for DOM-dependent files only (done in commit d8b7342 as
part of PR #94). This PR adds regression tests that verify the shared DOM-free
modules remain covered by `deno lint`, preventing accidental re-widening of the
exclusion in the future. Closes #91.

## Evidence

No UI changes. The quality gate passes cleanly:

```
==> Format (check)
Checked 42 files

==> Lint
Checked 19 files

==> Tests
ok | 83 passed | 0 failed
```

The 5 DOM-free modules are confirmed to be linted:

- `docs/shared/graph_analysis.js`
- `docs/shared/snapshot_loader.js`
- `docs/shared/colour_maps.js`
- `docs/impact_attribution.js`
- `docs/impact_diagnostics.js`

## Test Plan

Added `tests/lint_coverage_test.ts` with 6 new tests:

- 3 tests verifying each shared module (`graph_analysis.js`,
  `snapshot_loader.js`, `colour_maps.js`) is checked by `deno lint`
- 2 tests verifying `impact_attribution.js` and `impact_diagnostics.js` are
  checked by `deno lint`
- 1 test verifying the `deno.json` lint configuration excludes DOM-dependent
  files but not shared modules
