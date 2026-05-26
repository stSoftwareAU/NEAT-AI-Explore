## Summary

Added an explicit `timeout-minutes:` cap to every job across the eleven
workflows in `.github/workflows/`. Without it, a wedged step (a stuck
`http-server` + `pa11y-ci`, a hanging `deno test` against a flaky network
resource, a stalled `deno outdated --update`) holds a runner for the GitHub
default of 360 minutes (6 hours) and starves runner capacity. An explicit
per-job cap surfaces hangs as fast failures.

Caps applied (following the issue's suggested ranges — 5 minutes for lint/scan,
15–20 minutes for Deno test/coverage, 30 minutes for the weekly upgrade):

| Workflow                   | Job                 | timeout-minutes |
| -------------------------- | ------------------- | --------------- |
| `a11y.yml`                 | `a11y`              | 15              |
| `ci.yml`                   | `quality`           | 20              |
| `deno-quality.yml`         | `quality`           | 20              |
| `dependency-review.yml`    | `dependency-review` | 5               |
| `deploy.yml`               | `deploy`            | 15              |
| `gitleaks.yml`             | `gitleaks`          | 10              |
| `markdown-lint.yml`        | `markdownlint`      | 5               |
| `semgrep.yml`              | `semgrep`           | 15              |
| `semver-bump.yml`          | `update-version`    | 10              |
| `shellcheck.yml`           | `shellcheck`        | 5               |
| `upgrade-dependencies.yml` | `upgrade`           | 30              |

A new repo-wide test enforces the policy so any future workflow added without a
`timeout-minutes:` cap fails CI. Closes #257.

## Evidence

This is a CI-only change — no UI to screenshot. Verification is via the new
repo-wide test which fails against the pre-fix workflow set (every job missing
`timeout-minutes`) and passes once the caps are added.

Before:

```text
running 1 test from ./tests/workflow_job_timeout_test.ts
every workflow job declares timeout-minutes (#257) ... FAILED
error: Workflow jobs missing or with invalid timeout-minutes:
  a11y.yml: job 'a11y' is missing timeout-minutes
  ci.yml: job 'quality' is missing timeout-minutes
  ... (11 jobs total)
```

After:

```text
running 1 test from ./tests/workflow_job_timeout_test.ts
every workflow job declares timeout-minutes (#257) ... ok (6ms)

ok | 730 passed | 0 failed (3s)
```

## Test Plan

- Added
  `tests/workflow_job_timeout_test.ts::every workflow job declares
  timeout-minutes (#257)`
  — walks every `.yml`/`.yaml` file in `.github/workflows/`, parses each as
  YAML, and asserts every job has a positive-integer `timeout-minutes` no
  greater than 60 minutes. Fails against the pre-fix workflow set; passes after.
- `./quality.sh` — full quality gate (`deno fmt --check`, `deno lint`,
  `deno check`, `deno test -A`) passes cleanly with 730 tests.

## Out-of-scope edit

`docs/archive/pr-summaries/pr-summary-256.md` had a pre-existing `deno fmt`
failure (line wrapping) that was blocking `quality.sh`. Auto-formatted via
`deno fmt` — no content change.
