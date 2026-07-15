## Summary

The Markdown Lint CI workflow's `pull_request.branches` filter was `["*"]`.
GitHub Actions branch-filter globs treat `*` as "any character except `/`", so
`["*"]` matches single-segment branches (`Develop`, `main`) but never a
`milestone/<slug>` branch. Milestone sub-issue PRs target a shared
`milestone/<name>` branch, so the gate was silently skipped on every
intermediate sub-issue PR — they merged into the milestone branch unchecked and
the gap was only caught later by the single rollup PR into the default branch.

Added the `milestone/*` glob so the gate also runs on milestone sub-issue PRs,
matching the fix already applied to `deno-quality.yml` (#493), `actionlint.yml`
(#492) and `gitleaks.yml` (#494).

Closes #495.

## Evidence

Backend/CI-config change only — no web interface to screenshot.

`.github/workflows/markdown-lint.yml` filter change:

```yaml
on:
  pull_request:
    branches: ["*", "milestone/*"]
  workflow_dispatch:
```

```mermaid
flowchart LR
    A[Milestone sub-issue PR<br/>base = milestone slug] --> B{branches filter}
    B -->|"before: [\"*\"]"| C[No match → gate skipped]
    B -->|"after: [\"*\", \"milestone/*\"]"| D[Match → markdownlint runs]
```

Verified with the branch-glob semantics test below (fails before the fix, passes
after):

```
markdown-lint.yml runs on milestone/<slug> PRs (#495) ... ok
markdown-lint.yml still runs on ordinary single-level branches (#495) ... ok
```

Full quality gate: `807 passed | 0 failed`.

## Test Plan

- Added `tests/workflow_markdown_lint_milestone_branch_test.ts`, which parses
  `markdown-lint.yml` and asserts, using GitHub's branch-glob semantics, that
  the `pull_request.branches` filter matches `milestone/<slug>` branches while
  still matching ordinary single-level branches (`Develop`, `main`, `feature-x`)
  so existing coverage does not regress.
- Confirmed the milestone test fails against the unfixed `["*"]` filter and
  passes after adding `milestone/*`.
- Ran `./quality.sh` — all 807 tests pass.
