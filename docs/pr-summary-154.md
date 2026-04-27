## Summary

Added the **Dependency Review** GitHub Actions workflow at
`.github/workflows/dependency-review.yml`. The workflow runs on every pull
request and uses `actions/dependency-review-action@v4` to flag dependencies
with known vulnerabilities or licence issues before they are merged. Only the
minimal `contents: read` permission is granted. Closes #154.

## Evidence

This is a CI/security workflow change with no UI surface. Verified by a new
Deno test suite that loads and parses the YAML and asserts on its structure
(name, triggers, permissions, job, and the two required action steps).

```mermaid
flowchart LR
    A[Pull request opened/updated] --> B[Dependency Review job]
    B --> C[actions/checkout@v4]
    C --> D[actions/dependency-review-action@v4]
    D --> E{Vulnerable<br/>or disallowed<br/>licence?}
    E -- yes --> F[Fail PR check]
    E -- no --> G[Pass PR check]
```

## Test Plan

- Added `tests/dependency_review_workflow_test.ts` with five tests:
  - file exists
  - is valid YAML and named `Dependency Review`
  - triggers on `pull_request`
  - uses minimal `contents: read` permissions
  - runs `actions/dependency-review-action` after `actions/checkout`
- Ran `./quality.sh` — 380 tests pass, no lint or format issues.
