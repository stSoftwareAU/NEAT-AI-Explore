## Summary

Add a CI workflow (`.github/workflows/ci.yml`) that runs the quality gate on
every pull request targeting `Develop`. The workflow runs `deno fmt --check`,
`deno lint`, and `deno test -A` as separate steps so failures are easy to
diagnose. This prevents regressions, lint errors, and format violations from
being merged. Closes #87.

## Evidence

This is a CI/infrastructure change with no visual output. The workflow was
validated by confirming that `./quality.sh` passes locally (61 tests, 0
failures, no lint or format issues).

## Test Plan

- The workflow file uses the same Deno setup (`denoland/setup-deno@v2`,
  `deno-version: v2.x`) as the existing `deploy.yml` and `semver-bump.yml`
  workflows for consistency.
- Each quality check (format, lint, tests) runs as a separate step so that
  failures are clearly attributed.
- Verified locally that `./quality.sh` passes cleanly.
