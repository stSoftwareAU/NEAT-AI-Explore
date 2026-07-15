# CI quality workflow now gates milestone PRs

## Summary

The Deno quality CI workflow (`.github/workflows/deno-quality.yml`) filtered
pull requests with `branches: ["*"]`. GitHub Actions branch-filter globs treat
`*` as "any character except `/`", so a `milestone/<slug>` branch never matched
and the quality gate was silently skipped on every intermediate milestone
sub-issue PR — the gap was only caught later by the single rollup PR into the
default branch.

Added `milestone/*` to the `pull_request.branches` filter so the gate runs on
milestone PRs while still matching ordinary single-level branches. This mirrors
the fix already applied to `actionlint.yml` in #492. Closes #493.

```mermaid
flowchart LR
    A[Milestone sub-issue PR<br/>base = milestone/slug] -->|before: "*" skips /| B[gate skipped ❌]
    A -->|after: milestone/* matches| C[Quality Gate runs ✅]
```

## Evidence

Backend/CI-only change — no web interface to screenshot. Verified via a new unit
test that replicates GitHub Actions branch-glob semantics and asserts the
workflow's `pull_request.branches` filter matches `milestone/<slug>` branches.

- Before the fix: `deno-quality.yml runs on milestone/<slug> PRs (#493)` failed
  with `Got branches=["*"]`.
- After the fix: both tests pass; full `./quality.sh` run green (803 passed).

## Test Plan

- Added `tests/workflow_deno_quality_milestone_branch_test.ts`:
  - `deno-quality.yml runs on milestone/<slug> PRs (#493)` — asserts
    `milestone/foo` and `milestone/issue-493-fix` match the branch filter
    (reproduces the bug; failed before the fix).
  - `deno-quality.yml still runs on ordinary single-level branches (#493)` —
    asserts `Develop`, `main`, `feature-x` still match, guarding against
    regression.
