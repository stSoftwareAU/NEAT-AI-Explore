## Summary

Removed the unused export `findCandidate` from `docs/shared/candidate_views.js`.
A repo-wide identifier search over `docs/`, `helpers/`, `scripts/` and `tests/`
confirmed the only references were in `tests/candidate_comparison_test.ts` — no
production module, no own-file caller, and no dynamic/string-keyed lookup. The
sibling exports `CANDIDATE_VIEWS` and `buildCandidateHref` carry all production
behaviour of the module. Closes #590.

## Evidence

No web interface changed — this is a dead-code removal in a DOM-free module, so
there is nothing to screenshot. `./quality.sh` (format, lint, full Deno test
suite) passes cleanly: **1107 passed, 0 failed**.

## Test Plan

`tests/candidate_comparison_test.ts` no longer imports `findCandidate`. Its
coverage was preserved, not dropped (business-logic change documented here per
the "do not remove existing tests" rule):

- The dedicated test `findCandidate resolves each id and rejects unknown ones`
  was replaced by `each candidate id maps to its own view path`, which asserts
  the same id → path mapping (including the unknown-id case returning
  `undefined`) directly against `CANDIDATE_VIEWS`.
- The convenience call site in
  `an empty snapshot leaves the view on its own
  default` now indexes
  `CANDIDATE_VIEWS` instead.

All other tests in the file are unchanged.
