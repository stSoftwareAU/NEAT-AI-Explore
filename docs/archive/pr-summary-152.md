# Add Gitleaks Secrets Detection workflow

## Summary

Adds a new GitHub Actions workflow at `.github/workflows/gitleaks.yml` that runs
the official `gitleaks/gitleaks-action@v2` against every pull request, giving
the repository automated secrets detection on every change.

The workflow uses minimal `contents: read` permissions and checks the repo out
with `fetch-depth: 0` so gitleaks can scan the full git history.

Closes #152.

## Evidence

This is a CI-only change with no UI surface, so there is no screenshot to
capture. Behaviour is verified by unit tests that parse the workflow YAML and
assert on its structure (trigger, permissions, steps).

```mermaid
flowchart LR
    PR[Pull Request opened] --> WF[gitleaks.yml workflow]
    WF --> CO[actions/checkout@v4<br/>fetch-depth: 0]
    CO --> GL[gitleaks/gitleaks-action@v2]
    GL --> Pass{Secrets found?}
    Pass -->|No| OK[Check passes]
    Pass -->|Yes| Fail[Check fails<br/>blocks merge]
```

### Pre-existing format issues (out of scope)

`deno fmt --check` reports three pre-existing formatting issues in
`docs/index.html`, `docs/graph/index.html`, and `docs/starfield/index.html` that
exist on `Develop` (introduced by PR #149). These are unrelated to this change
and have been left untouched per the change-scope policy. The new files added by
this PR (`.github/workflows/gitleaks.yml` and `tests/gitleaks_workflow_test.ts`)
are clean against `deno fmt --check` and `deno lint`.

## Test Plan

Added `tests/gitleaks_workflow_test.ts` with 5 cases that load and parse the
actual workflow file:

- Workflow file exists at `.github/workflows/gitleaks.yml`.
- Workflow YAML is parseable and named `Gitleaks`.
- Workflow triggers on `pull_request` events.
- Workflow grants only `contents: read` permissions.
- Workflow runs `actions/checkout@v4` with `fetch-depth: 0` and then
  `gitleaks/gitleaks-action@v2`.

Also added `@std/yaml` to `deno.json` imports so the test can parse the workflow
via a bare specifier (the project's lint config disallows inline `https:`
imports).

Run the targeted tests with:

```bash
deno test -A tests/gitleaks_workflow_test.ts < /dev/null
```

All 5 tests pass.
