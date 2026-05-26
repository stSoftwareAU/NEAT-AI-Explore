## Summary

Removed the wall-clock timing assertion from
`tests/observation_contributions_test.ts` ("cycles are finite and
deterministic"). The 2000ms ceiling was a flaky performance budget masquerading
as a termination check — termination is already covered by the Deno test
runner's own timeout and by the behavioural assertions on `res.inputs` further
down the test. Performance budgets belong in a benchmark, not a unit test.
Closes #264.

## Evidence

This is a test-only CLI change — no UI surface to screenshot.

Verification:

- `deno test tests/observation_contributions_test.ts` — all 6 tests pass (the
  cycle test runs in 0ms locally).
- `./quality.sh` — full suite: 727 passed, 0 failed.

The behavioural guarantees the test was always meant to verify remain intact:

- `assertEquals(res.inputs.length, 1, ...)` — only `input-0` is reachable.
- `assertEquals(res.inputs[0].uuid, "input-0")` — correct input identified.
- `approx(res.inputs[0].score, 1, 1e-9)` — full share attributed.
- Determinism check — second walk returns identical output.

A real infinite loop would never reach those assertions; the Deno runner would
kill the test first.

## Test Plan

- Modified `tests/observation_contributions_test.ts` — deleted the
  `performance.now()` start/end measurement and the `elapsedMs < 2000`
  assertion. Kept every behavioural assertion in the same test. Added a comment
  explaining why the timing check was removed and pointing at issue #264.
- Ran the affected test file in isolation — 6/6 pass.
- Ran the full `./quality.sh` gate — 727/727 pass.
