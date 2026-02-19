## Summary

Replace the plain property list (`<dl>`) for neuron details with visually rich
card components grouped into labelled sections: Identity, Activation,
Diagnostics, Error Metrics, and Reconstruction. Each card features themed
styling with rounded corners and subtle shadows, and includes inline sparkline
charts for activation history and error distribution histograms.

Closes #107.

## Changes

- **New module `docs/shared/sparkline.js`** — Pure, DOM-free computation
  functions for sparkline point normalisation, error histogram bucketing, squash
  badge classification, and error flattening. Fully unit-testable.
- **Card layout in `docs/app.js`** — `renderCurrentNeuron()` now groups
  properties into themed cards with section headings, colour-coded squash badges
  (blue=SIGMOID, purple=TANH, green=RELU, orange=STEP), inline SVG sparklines
  for activation data, and mini bar charts for error distribution.
- **Responsive CSS in `docs/styles.css`** — 2-column grid on desktop,
  single-column stack on mobile (≤600px). Card entrance animation (slide up +
  fade in) respects `prefers-reduced-motion`.
- **HTML update** — Changed `#neuronProps` from `<dl>` to `<div>` container.
- **Tests** — 24 new unit tests for sparkline computation logic.
- **Lint coverage** — Added `sparkline.js` to shared module lint coverage.

## Evidence

### Desktop (2-column card layout with sparkline and error histogram)

![Neuron cards desktop](docs/evidence/neuron-cards-desktop.png)

### Mobile (single-column stack)

![Neuron cards mobile](docs/evidence/neuron-cards-mobile.png)

### Focused neuron panel detail

![Neuron cards detail](docs/evidence/neuron-cards-detail.png)

## Test Plan

- Added `tests/sparkline_test.ts` with 24 tests covering:
  - `computeSparklinePoints`: empty input, normalisation, constant values,
    single value, NaN/Infinity handling, negative values
  - `computeErrorHistogram`: empty input, correct bucketing, ratio calculation,
    single value, non-finite filtering
  - `squashBadge`: all colour categories (blue, purple, green, orange, grey),
    case insensitivity, null handling
  - `flattenErrors`: 2D and 1D arrays, absolute value conversion, null input,
    non-finite filtering
- All 210 tests pass (`./quality.sh` clean)
