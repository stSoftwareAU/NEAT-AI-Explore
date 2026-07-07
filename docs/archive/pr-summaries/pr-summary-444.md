## Summary

Removed three magic-value change-detector assertions in
`tests/impact_diagnostics_constants_test.ts` that pinned *internal
numerical-stability tuning constants* to their current literals with no external
spec justifying the number. Following resolution (a) from the issue, the bare
`assertEquals` lines were replaced/folded into behavioural coverage so the suite
tracks the stability guarantee rather than the tuning number, while the
spec-backed activation-parameter tests (SELU/GELU/LEAKY-RELU/ELU) were kept
because they encode published values. Closes #444.

Changes:

- **`NEAR_ZERO_THRESHOLD is 1e-6`** — replaced the bare equality with a
  behavioural test that drives `computeSquashDerivativeStats` with two EXP
  pre-activations placed precisely either side of the threshold
  (`ln(THRESHOLD/2)` and `ln(THRESHOLD*2)`) and asserts `fracNearZero == 0.5`.
  This exercises the near-zero classification boundary; a behaviour-preserving
  retune of the constant moves both derived inputs with it, so the test keeps
  passing.
- **`EXP_CLAMP_MAX is 50`** and **`GAUSSIAN_CLAMP_MAX is 100`** — deleted the
  bare-equality cases. The existing behavioural clamp tests ("EXP clamps extreme
  inputs to avoid Infinity" and "GAUSSIAN clamps extreme inputs to avoid
  underflow") already pin the real contract — extreme inputs stay finite and the
  clamp bites at the boundary — so no coverage is lost. A comment documents why
  these arbitrary guardrails are not pinned by literal.

## Evidence

Backend/test-only change — no web interface to screenshot. Verified via
`deno test` and the full `./quality.sh` gate.

```
deno test tests/impact_diagnostics_constants_test.ts
ok | 13 passed | 0 failed

./quality.sh
ok | 754 passed | 0 failed
==> OK
```

## Test Plan

- Rewrote `tests/impact_diagnostics_constants_test.ts::NEAR_ZERO_THRESHOLD is
  the boundary for near-zero derivative classification` — behavioural assertion
  via `computeSquashDerivativeStats`.
- Removed the redundant change-detector cases `EXP_CLAMP_MAX is 50` and
  `GAUSSIAN_CLAMP_MAX is 100`; behaviour remains covered by the existing EXP /
  GAUSSIAN clamp tests in the same file.
- Kept the spec-backed constant tests (SELU_LAMBDA, SELU_ALPHA,
  GELU_APPROX_COEFF, LEAKY_RELU_SLOPE, ELU_ALPHA) unchanged.
- `./quality.sh < /dev/null` passes cleanly (754 tests).
