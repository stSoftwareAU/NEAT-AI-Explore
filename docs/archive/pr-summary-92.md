## Summary

Export named constants from `impact_diagnostics.js` so they are available for
import and testing. The constants (`NEAR_ZERO_THRESHOLD`, `SELU_LAMBDA`,
`SELU_ALPHA`, `GELU_APPROX_COEFF`, `LEAKY_RELU_SLOPE`, `ELU_ALPHA`,
`EXP_CLAMP_MAX`, `GAUSSIAN_CLAMP_MAX`) were already extracted from inline magic
numbers in a prior change; this PR makes them `export const` and adds
comprehensive tests verifying both their values and their behavioural effects on
`squashDerivative()`. Closes #92.

## Evidence

This is a pure code/test change with no UI impact. All 98 tests pass, including
the 15 new constant tests. Quality gate (`./quality.sh`) passes cleanly.

## Test Plan

- Added `tests/impact_diagnostics_constants_test.ts` with 15 tests:
  - 8 constant value assertions (one per exported constant)
  - 7 behavioural tests verifying constants drive correct `squashDerivative`
    output:
    - `LEAKYRELU` negative derivative equals `LEAKY_RELU_SLOPE`
    - `SELU` positive derivative equals `SELU_LAMBDA`
    - `SELU` negative derivative uses `SELU_LAMBDA * SELU_ALPHA * exp(x)`
    - `ELU` negative derivative uses `ELU_ALPHA * exp(x)`
    - `EXP` clamps extreme inputs via `EXP_CLAMP_MAX` (avoids Infinity)
    - `GAUSSIAN` clamps extreme inputs via `GAUSSIAN_CLAMP_MAX`
    - `GELU` derivative matches formula using `GELU_APPROX_COEFF`
