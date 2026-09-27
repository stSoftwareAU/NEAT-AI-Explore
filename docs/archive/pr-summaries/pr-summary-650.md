## Summary

Every gate test invocation now uses Deno's quiet `dot` reporter, so a green run
no longer prints a pass line per test and a red run's failure is not buried.
Closes #650.

- `.github/workflows/deno-quality.yml` — required `Tests with coverage` step:
  `deno test -A --reporter=dot --coverage=cov_profile`
- `quality.sh` — `deno test -A --reporter=dot`
- `deno.json` — `test` task: `deno test --allow-read --reporter=dot`
- `README.md` / `CONTRIBUTING.md` — gate descriptions updated to match.

## Evidence

CI/tooling change only — no UI. A deliberately failing test run with
`--reporter=dot` still prints the test name, location, assertion message, stack
trace and a `FAILURES` summary, and exits non-zero:

```text
deliberately fails => ./fail_test.ts:2:6
error: Error: expected 1 but got 2
  throw new Error("expected 1 but got 2");
        ^
    at file:///tmp/dotcheck/fail_test.ts:3:9

 FAILURES

deliberately fails => ./fail_test.ts:2:6

FAILED | 1 passed | 1 failed (2ms)
error: Test failed        (exit=1)
```

`./quality.sh` on the committed tree: `ok | 1209 passed (70 steps) | 0 failed`.

## Test Plan

- Added `tests/quiet_test_reporter_test.ts` — parses the CI workflow YAML,
  `quality.sh` and the `deno.json` `test` task, and asserts every `deno test`
  command carries `--reporter=dot`. Observed failing (3 of 4) before the fix and
  passing after.
