# PR Summary — Issue #158

## Summary

Adds `.github/workflows/upgrade-dependencies.yml`, a weekly Deno dependency-bump
workflow modelled on NEAT-AI-core's Cargo `upgrade-dependencies.yml`. Runs every
Monday at 06:00 UTC (and on demand via `workflow_dispatch`), captures
`deno outdated --update --latest` output to a dry-run log, detects changes to
`deno.json` / `deno.lock`, builds a markdown summary embedding the log, and
opens a PR against `Develop` via `peter-evans/create-pull-request@v7`.

The earlier, simpler `deno-outdated.yml` (from #155) is removed, as the issue
states this work supersedes it. The README now mentions the new workflow.

Closes #158.

## Evidence

```mermaid
flowchart LR
    A[Cron: Mon 06:00 UTC] --> B[Checkout Develop]
    M[Manual workflow_dispatch] --> B
    B --> C[Setup Deno v2.x]
    C --> D[deno outdated --latest tee dry-run.txt]
    D --> E[deno outdated --update --latest tee upgrade.log]
    E --> F{deno.json or deno.lock changed?}
    F -- no --> X[Exit cleanly]
    F -- yes --> G[Build PR body with dry-run log]
    G --> H[peter-evans/create-pull-request@v7]
    H --> I[PR -> Develop: chore/upgrade-dependencies]
```

This is a CI/workflow-only change — no UI to screenshot. Verified locally via:

- `deno test -A tests/upgrade_dependencies_workflow_test.ts` — all 9 new
  workflow tests pass.
- `./quality.sh` — full quality gate (`deno fmt --check`, `deno lint`,
  `deno check`, `deno test`) passes with **391 tests, 0 failures**.

## Test Plan

- Added `tests/upgrade_dependencies_workflow_test.ts` (9 tests) — parses the
  workflow YAML and asserts on:
  - File presence and workflow name.
  - Weekly cron `0 6 * * 1` plus `workflow_dispatch`.
  - `contents: write` and `pull-requests: write` permissions.
  - Checkout targets the `Develop` branch.
  - Deno is set up at `v2.x` via `denoland/setup-deno@v2`.
  - `deno outdated --update --latest` is invoked with `tee` capture for the PR
    body.
  - Change-detection step (id `changes`) inspects `deno.json` and `deno.lock`
    via `git diff` and emits `changed=true|false`.
  - Summary step (id `summary`) is gated on `changed == 'true'` and embeds
    `upgrade-dry-run.txt` inside a fenced code block.
  - PR step uses `peter-evans/create-pull-request@v7`, base `Develop`, branch
    `chore/upgrade-dependencies`, the issue-specified title/commit message,
    `delete-branch: true`, and `github-actions[bot]` committer/author.
- Removed `tests/deno_outdated_workflow_test.ts` — the workflow it covered
  (`deno-outdated.yml`) is superseded by this PR per the issue body, so its test
  goes with it.

## Acceptance Criteria

- [x] `.github/workflows/upgrade-dependencies.yml` exists and parses as valid
      YAML (verified by tests).
- [x] Workflow triggers match NEAT-AI-core (`schedule` weekly +
      `workflow_dispatch`).
- [x] Workflow runs `deno outdated --update --latest` and detects changes to
      `deno.json`/`deno.lock` before opening a PR.
- [x] When changes are detected, a PR is opened against `Develop` with
      `branch: chore/upgrade-dependencies`, `delete-branch: true`, and a body
      that includes the dry-run output in a code block.
- [x] When no changes are detected, no PR is opened (steps are gated on
      `steps.changes.outputs.changed == 'true'`).
- [ ] Manual `workflow_dispatch` run after merge — to be triggered after merge.
- [x] `README.md` mentions the auto-bump workflow.
- [x] Existing quality gate passes (`./quality.sh`: 391 tests, 0 failures).
