## Summary

Reworded the sole private-repo reference in `docs/archive/pr-summary-172.md`
(line 9) to concept level. The archived PR summary named a private internal
workflow-automation repository when describing its `deno-quality` sync. Since
everything under `docs/` is published to the public GitHub Pages site, this
named a private automation project to every public reader. The sentence now
reads "addressing the organisation's internal workflow auditor's `deno-quality`
sync", describing the idea without leaking the private repo's name. Closes #518.

## Evidence

Documentation-only change — no web interface to screenshot. The full quality
gate (`./quality.sh`) passes cleanly, including `deno fmt --check` (which
required re-wrapping the edited line) and all 877 tests.

A repo-wide grep for the private repository's name across `docs/` returns no
matches after the change, confirming the reference is fully removed.

## Test Plan

- No behavioural code changed, so no unit tests were added — this is a textual
  documentation reword.
- Ran `./quality.sh < /dev/null`: bash syntax, ShellCheck, `deno fmt --check`,
  `deno lint`, `deno check`, and 877 tests all pass.
- Verified that grepping `docs/` for the private repository's name yields no
  remaining references.
