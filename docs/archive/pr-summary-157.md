## Summary

Completed the Deno Lint and Format CI workflow by adding the missing
`deno check` type-checking step. The Quality Gate workflow now exercises all
three Deno quality capabilities — lint, format, and type check — alongside the
existing test suite. Closes #157.

The local `quality.sh` script gains a parallel `Type check` stage so local runs
mirror CI exactly.

## Evidence

This is a CI/build configuration change with no UI surface to screenshot.

Verification:

- `tests/ci_workflow_test.ts` parses `.github/workflows/ci.yml` and asserts the
  presence of `deno fmt --check`, `deno lint`, `deno check`, and the
  `denoland/setup-deno` setup step. The new `deno check` assertion failed before
  the workflow change and passes after it.
- `./quality.sh` runs cleanly end-to-end (387 tests pass, type check across
  `helpers/`, `scripts/`, and `tests/` succeeds).

```mermaid
flowchart LR
    PR[Pull Request] --> CO[Checkout]
    CO --> SD[Setup Deno]
    SD --> FMT[deno fmt --check]
    FMT --> LINT[deno lint]
    LINT --> TC[deno check helpers/ scripts/ tests/]
    TC --> TST[deno test -A]
```

## Test Plan

- Added `tests/ci_workflow_test.ts` with seven assertions covering the
  workflow's name, permissions, trigger, Deno setup, and each quality step
  (`deno fmt --check`, `deno lint`, `deno check`).
- Re-ran the full suite via `./quality.sh < /dev/null` — all 387 tests pass.
