## Summary

Extract pure computation functions from `docs/app.js` into testable
`docs/shared/` modules with comprehensive unit tests. Closes #127.

Three new shared modules:

- **`docs/shared/correlation.js`** — `pearsonCorrelation`, `sampleSeries`,
  `computeTopInputCorrelations` (Pearson correlation across input pairs)
- **`docs/shared/discovery.js`** — `normaliseCandidate`,
  `extractDiscoveryCandidates` (multi-path schema normalisation for discovery
  candidates)
- **`docs/shared/diagnostics_scan.js`** — `scan1d`, `scan2d`,
  `computeNonFiniteIssues`, `computeErrorConcentrationIssues` (recording data
  quality scanning)

`app.js` now imports from these modules instead of defining them inline,
reducing ~340 lines from the monolithic file.

## Evidence

No UI changes — this is a pure refactor extracting existing functions into
shared modules. The extracted functions are identical to the originals.
`./quality.sh` passes (format, lint, 302 tests).

## Test Plan

- `tests/correlation_test.ts` — 13 tests covering `pearsonCorrelation`,
  `sampleSeries`, and `computeTopInputCorrelations` (perfect correlation,
  anti-correlation, edge cases, topK limits, maxInputs cap, fallback to value
  series)
- `tests/discovery_test.ts` — 21 tests covering `normaliseCandidate` and
  `extractDiscoveryCandidates` (camelCase, snake_case, nested synapse,
  newWeights array, explicit weights, w1/w2 shorthand, new neuron info, key
  generation, null/invalid inputs, all schema paths)
- `tests/diagnostics_scan_test.ts` — 20 tests covering `scan1d`, `scan2d`,
  `computeNonFiniteIssues`, and `computeErrorConcentrationIssues` (clean data,
  NaN/Infinity detection, obsIndices mapping, null recording, error
  concentration)
