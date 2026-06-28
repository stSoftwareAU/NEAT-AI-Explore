## Summary

Removed the dead-code exports `formatLarge` and `formatSigned` from
`docs/shared/number_format.js`. Module-graph analysis confirmed both helpers
were imported only by `tests/number_format_test.ts` — no `docs/**` application
source (`docs/app.js`, `docs/graph/graph.js`, `docs/sw.js`) imports, calls, or
dynamically looks them up, and they are not referenced by any sibling export or
barrel. The surviving helpers `formatInteger` and `formatDecimal` (the ones the
app actually uses) are untouched.

Changes:

- Deleted `formatLarge` and `formatSigned` and their JSDoc from
  `docs/shared/number_format.js`.
- Trimmed the module docstring to drop the now-inaccurate "large-number
  suffixes" mention.
- Removed the corresponding test cases and unused imports from
  `tests/number_format_test.ts`.

Closes #397.

## Evidence

Backend/shared-module change with no web interface to screenshot. Verified by
the full quality gate (`./quality.sh`) which passed cleanly: **745 passed | 0
failed**.

Confirmation that no application code referenced the removed symbols:

```
$ grep -rn "formatLarge\|formatSigned" docs/ --include="*.js" --include="*.html"
docs/shared/number_format.js   # (definitions only — now removed)
```

All remaining references were in `tests/number_format_test.ts`, which has been
updated.

## Test Plan

- `tests/number_format_test.ts` — removed the `formatLarge` and `formatSigned`
  test suites and their imports. The remaining `formatInteger` and
  `formatDecimal` suites (8 tests) continue to pass, proving the live helpers
  are unaffected.
- `./quality.sh < /dev/null` — full suite passes (745 passed | 0 failed),
  confirming no other module depended on the removed exports.
