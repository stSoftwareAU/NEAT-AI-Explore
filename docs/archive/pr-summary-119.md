## Summary

The network topology diagram previously showed a traditional linear layer chain
(input → hidden 1 → hidden 2 → … → output) which did not reflect the weaved
NEAT-style architecture where observations can connect directly to outputs or
skip several hidden layers. This change replaces the linear chain with an
SVG-based diagram that renders **inter-layer edges**, including skip connections
shown as dashed arcs above the layer nodes. A summary line shows the total
skip-connection count and number of distinct paths. Closes #119.

### What changed

- **`docs/shared/creature_overview.js`** — `computeLayerTopology` now returns an
  `edges` array alongside `layers`. Each edge records `{ from, to, count }`
  where `from`/`to` are layer indices and `count` is the number of synapses on
  that inter-layer path.
- **`docs/app.js`** — `renderTopologyDiagram` rewritten to use inline SVG:
  coloured circles for layer nodes, straight lines for adjacent connections, and
  dashed quadratic-Bézier arcs for skip connections. A summary line below shows
  the skip-connection totals.
- **`docs/styles.css`** — old HTML-based topology styles replaced with SVG
  styles (`.topoSvg`, `.topoSkipSummary`).
- **`tests/creature_overview_test.ts`** — 4 new tests for edge computation:
  adjacent edges, skip-connection edges, synapse counts per edge, and empty
  network.

## Evidence

![Topology diagram with skip connections](docs/evidence/topology-skip-connections.png)

The screenshot shows 34 layers with 15,706 skip-connections across 415 distinct
paths — the dashed arcs make the NEAT-style weaved connectivity clearly visible.

## Test Plan

- `computeLayerTopology returns edges between adjacent layers`
- `computeLayerTopology returns skip-connection edges`
- `computeLayerTopology edges include synapse count`
- `computeLayerTopology edges empty for no synapses`
- All 229 existing tests continue to pass
