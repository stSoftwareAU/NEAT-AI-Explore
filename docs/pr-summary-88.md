## Summary

Eliminate duplication between root and `docs/` copies of `impact_attribution.js`
and `impact_diagnostics.js`. Closes #88.

Both files existed as exact duplicates at the repo root and under `docs/`. The
root copies served Deno tests; the `docs/` copies were deployed. There was no
automated synchronisation, so the two copies could drift silently.

**Fix:** Delete the root-level copies and update all test imports to reference
`docs/` directly — the same pattern already used by `graph_analysis.js` tests.
The `docs/` files are now the single source of truth for both the app and tests.

### Changes

- **Deleted**: `impact_attribution.js` (root), `impact_diagnostics.js` (root)
- **Updated imports** in 3 test files:
  - `tests/impact_attribution_test.ts`
  - `tests/impact_diagnostics_test.ts`
  - `tests/inbound_allocation_test.ts`
- **Updated README.md**: module table and shared-modules description now
  reference `docs/` paths

## Evidence

This is a purely structural refactor with no UI changes. All 61 existing tests
pass with the updated import paths:

```
ok | 61 passed | 0 failed (294ms)
```

The full quality gate (`./quality.sh`) passes: format check, lint, and all
tests.

## Test Plan

- No new tests added — this is a path-only refactor
- All 28 impact module tests continue to pass unchanged (same assertions, same
  modules, different import path)
- Full quality gate passes cleanly
