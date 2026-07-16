## Summary

Five CI quality gates restricted their `pull_request` trigger to
`branches: ["*"]`. GitHub's `*` wildcard does not cross a `/`, so it never
matches a `milestone/<slug>` branch — these gates were silently skipped on every
milestone sub-issue PR, letting accessibility regressions, bash/ShellCheck
breakages and freshly-disclosed dependency advisories merge into the shared
milestone branch unchecked until the single rollup PR.

Added `milestone/*` to each workflow's `pull_request.branches` filter, mirroring
the fix already applied to the sibling gates (`actionlint`, `deno-quality`,
`gitleaks`, `markdown-lint`, `semgrep` — #492–#496). The explicit `milestone/*`
glob keeps the intent legible; milestone branch names carry no nested slashes so
the single-level glob suffices. Per Issue #3239 isolation the fix is a normal
per-repo change — no shared cross-repo mechanism.

Workflows updated:

- `.github/workflows/a11y.yml` — Accessibility (pa11y-ci) gate
- `.github/workflows/bash-syntax.yml` — `bash -n` syntax gate
- `.github/workflows/dependency-audit.yml` — `deno audit` vulnerability scan
- `.github/workflows/dependency-review.yml` — dependency-review scan
- `.github/workflows/shellcheck.yml` — ShellCheck lint gate

Closes #497.

## Evidence

Backend/CI-config change with no web interface to screenshot. Verified via new
Deno unit tests that parse each workflow YAML and replicate GitHub's branch-glob
semantics (`*` stops at `/`, `**` crosses it) to assert the filter now matches
`milestone/<slug>` branches while still matching ordinary single-level branches
(`Develop`, `main`, `feature-x`). Full `./quality.sh` passes: 819 tests, 0
failed.

```mermaid
flowchart LR
    PR["milestone/&lt;slug&gt; sub-issue PR"] --> F{"branches filter"}
    F -->|"[\"*\"] — before"| SKIP["gate skipped ❌"]
    F -->|"[\"*\", \"milestone/*\"] — after"| RUN["gate runs ✅"]
```

## Test Plan

Added five milestone-branch tests, each mirroring the sibling
`workflow_semgrep_milestone_branch_test.ts` pattern:

- `tests/workflow_a11y_milestone_branch_test.ts`
- `tests/workflow_bash_syntax_milestone_branch_test.ts`
- `tests/workflow_dependency_audit_milestone_branch_test.ts`
- `tests/workflow_dependency_review_milestone_branch_test.ts`
- `tests/workflow_shellcheck_milestone_branch_test.ts`

Each asserts the workflow's `pull_request.branches` filter matches
`milestone/foo` and `milestone/issue-497-fix`, and still matches `Develop`,
`main` and `feature-x` (no regression). All five tests reproduce the bug against
the unfixed workflows (red) and pass after the fix (green).
