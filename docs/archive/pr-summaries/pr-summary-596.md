## Summary

`docs/archive/pr-summaries/pr-summary-518.md` named a private `stSoftwareAU`
repository three times while describing the fix that had removed that very name
from `docs/archive/pr-summary-172.md`. Because everything under `docs/` is
published to the public GitHub Pages site, the archived summary undid the
anonymisation it was documenting.

All three mentions are now at concept level: the repository is described by its
role ("a private internal workflow-automation repository"), and the evidence and
test-plan lines refer to "grepping `docs/` for the private repository's name"
rather than quoting the name. A new guard test walks the published `docs/` tree
and fails if any private repo name reappears, so the regression cannot recur
silently. Closes #596.

## Evidence

Documentation-only change — no web interface to screenshot.

- `tests/docs_private_repo_reference_test.ts` failed against the unfixed file,
  naming `docs/archive/pr-summaries/pr-summary-518.md` as the offender, and
  passes after the reword.
- `./quality.sh < /dev/null` passes cleanly: bash syntax, ShellCheck,
  `deno fmt --check`, `deno lint`, `deno check`, and 1111 tests.

The guard test builds the forbidden name from fragments at runtime so the test
file itself never becomes a textual mention of a private repo.

## Test Plan

- Added `tests/docs_private_repo_reference_test.ts` — recursively reads every
  text file under `docs/` and asserts none contains a private `stSoftwareAU`
  repository name. This is the regression test for #596: it fails on the unfixed
  `pr-summary-518.md` and passes after the reword.
- No behavioural code changed, so no other tests were added or modified.
