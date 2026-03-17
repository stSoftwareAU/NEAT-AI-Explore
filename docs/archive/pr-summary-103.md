## Summary

Add a creature overview dashboard that gives users an at-a-glance summary of the
loaded neural network before diving into individual neurons. The dashboard shows
after loading a snapshot and includes network metrics, activation function
distribution, and an interactive mini topology diagram. Closes #103.

### What changed

- **New shared module** `docs/shared/creature_overview.js` — pure, DOM-free
  functions for computing summary statistics:
  - `computeNeuronBreakdown` — counts neurons by type
    (input/hidden/output/constant)
  - `computeSynapseStats` — total synapse count and average connectivity
  - `computeNetworkDepth` — longest path from any input to any output
  - `computeActivationDistribution` — counts per activation function
  - `computeLayerTopology` — simplified layer structure for topology diagram

- **Overview dashboard UI** in `index.html`, `app.js`, and `styles.css`:
  - Three cards: Network Summary, Activation Functions, Network Topology
  - Mini topology diagram with colour-coded circles (input/hidden/output)
  - Click any layer to navigate directly into the trace explorer
  - "Explore Neurons →" button to enter the trace explorer
  - "Clear" returns to the overview dashboard

- **Responsive layout** — stacks cards vertically on screens < 768px
- **Theme support** — uses existing CSS custom properties for light/dark/auto
- **Entrance animation** — staggered fade/slide with `prefers-reduced-motion`
  support

## Evidence

![Overview dashboard (desktop)](docs/evidence/overview-dashboard.png)
![Overview dashboard (mobile)](docs/evidence/overview-dashboard-mobile.png)

## Test Plan

- 18 new unit tests in `tests/creature_overview_test.ts` covering all 5 metric
  computation functions with edge cases (empty arrays, direct input-to-output,
  multiple hidden depths, constant neurons, zero neurons)
- Updated `tests/lint_coverage_test.ts` to include `creature_overview.js`
- All 126 existing + new tests pass via `./quality.sh`
