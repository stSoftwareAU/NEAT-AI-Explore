# Remove unused export `isSelectionSquash` (Issue #591)

## Summary

Deleted the dead `isSelectionSquash` export from
`docs/shared/selection_attribution.js`. It was a one-line predicate over
`normaliseSelectionSquash`, and the only production caller
(`docs/impact_attribution.js`) uses `normaliseSelectionSquash` directly — the
wrapper's sole importer was its own test.

Verified before removal with a repo-wide identifier grep over `docs/`,
`helpers/`, `scripts/` and `tests/` (`.js`/`.ts`/`.html`): the only occurrences
were the declaration, the test import, and the README's testable-modules table.
A separate grep for partial/dynamic squash identifiers found no string-keyed or
reflective use.

Closes #591.

## Evidence

No web interface changed — this is a pure dead-code removal in a DOM-free
module, so no screenshot applies. Evidence is the quality gate:
`./quality.sh < /dev/null` passes with **1105 tests, 0 failed**, covering lint,
type check, formatting and the full Deno test suite.

## Test Plan

**Test removed (intentional, documented per the issue's suggested action):**

- `tests/selection_attribution_test.ts::isSelectionSquash is true only for
  MIN/MAX/IF family`
  — the function under test no longer exists, so the test cannot be retained.

**Coverage preserved:** the removed test's only unique assertion was that
`SIGMOID` is not a selection squash. That case was folded into the existing
`normaliseSelectionSquash returns null for non-selection squashes` test, which
now asserts `normaliseSelectionSquash("SIGMOID") === null`. The MIN/MAX/IF
positive cases were already covered by
`normaliseSelectionSquash maps aliases and lower/upper case`.

**Docs:** removed `isSelectionSquash` from the README's "What can be
unit-tested" table row for `docs/shared/selection_attribution.js`.
