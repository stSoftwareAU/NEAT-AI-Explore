## Summary

Removed the unused export `findCandidate` from `docs/shared/candidate_views.js`.
Module-graph analysis confirmed no production module imported it — the
comparison page and the other consumers iterate `CANDIDATE_VIEWS` and build
links with `buildCandidateHref` directly, and the function had no callers inside
its own file. A repo-wide grep after the change reports zero remaining
references. Closes #590.

## Evidence

No UI or behaviour change — this is a dead-code removal in a DOM-free module, so
there is nothing to screenshot. Verified by the full quality gate
(`./quality.sh`): `deno fmt --check`, `deno lint`, `deno check` over
`helpers/ scripts/ tests/ docs/`, and `deno test -A` — **1106 passed, 0
failed**.

## Test Plan

**Documented test modification** (required by the business-logic change): the
dedicated test `findCandidate resolves each id and rejects unknown ones` in
`tests/candidate_comparison_test.ts` tested only the deleted function and was
removed along with its import. Its coverage was **not** lost:

- The id → path mapping it pinned (`dag` → `../dag/`, `sankey` → `../sankey/`,
  `subgraph` → `../subgraph/`, and an unknown id resolving to `undefined`) moved
  into the existing test `the chooser lists all three candidate views`, asserted
  against `CANDIDATE_VIEWS` directly.
- The convenience call site in
  `an empty snapshot leaves the view on its own
  default` now indexes
  `CANDIDATE_VIEWS` instead of calling `findCandidate`; its assertions are
  unchanged.

No other tests were added, removed, or weakened.
