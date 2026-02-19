## Summary

Add colour-coded synapse edges by weight strength and contribution to both the
trace explorer and graph explorer views. Synapses are now visually coded: green
for excitatory (positive weight), red for inhibitory (negative weight), and grey
for weak/near-zero connections. Stronger weights produce more saturated colours.
Closes #105.

## Changes

- **`docs/shared/colour_maps.js`** — Added three new exported functions:
  - `synapseWeightStrength01(weight, maxAbsWeight)` — normalised strength [0,1]
  - `synapseWeightColourRgb01(weight, maxAbsWeight)` — RGB [0,1] colour tuple
  - `synapseWeightColourCss(weight, maxAbsWeight)` — CSS `rgb(…)` string
- **`docs/app.js`** (trace explorer) — Synapse rows now have a colour-coded left
  border and an inline colour chip next to the weight badge. A collapsible
  "Weight colour scale" legend is prepended to the synapse list.
- **`docs/graph/graph.js`** (graph explorer) — Replaced hardcoded green/red base
  colours with the shared `synapseWeightColourRgb01` function, so edge colours
  now reflect weight strength (more saturated = stronger).
- **`docs/graph/index.html`** — Added "Edge colour" and "Edge width" entries to
  the graph legend panel.
- **`docs/styles.css`** — Added `.weightChip` and `.synapseLegend` styles.
- **`README.md`** — Documented the new feature and updated the testable
  functions table.

## Evidence

### Trace explorer — colour-coded synapse rows with legend

![Trace explorer synapse colours](docs/evidence/trace-synapse-colours.png)

### Graph explorer — colour-coded edges with legend

![Graph explorer synapse colours](docs/evidence/graph-synapse-colours.png)

## Test Plan

- 15 new unit tests added to `tests/colour_maps_test.ts`:
  - `synapseWeightStrength01`: zero weight, max weight, clamping, zero
    maxAbsWeight, proportional scaling
  - `synapseWeightColourRgb01`: RGB range, positive→green, negative→red,
    near-zero→grey, saturation scaling, zero weight, default maxAbsWeight
  - `synapseWeightColourCss`: valid `rgb()` format, positive→greenish,
    negative→reddish
- All 152 tests pass (28 colour map tests, including 15 new)
- `./quality.sh` passes cleanly (format, lint, test)
