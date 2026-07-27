# Candidate graph-view evaluation and winner selection (Issue #528)

Part of the #522 redesign. Three candidate replacement views for the retiring 3D
starfield (`/graph/`) were built side by side and are now reachable and
comparable on the **same** snapshot via `/compare/`:

- **Layered DAG** (`/dag/`, Issue #525) — layered 2D directed graph with a
  per-node impact overlay.
- **Sankey contribution flow** (`/sankey/`, Issue #526) — conserved flow from
  observation families to the Score.
- **Top-impact subgraph** (`/subgraph/`, Issue #527) — only the highest-impact
  paths; everything else is reported as a dead zone.

All three consume the shared aggregated graph model
(`shared/aggregated_graph_model.js`, Issue #524), so they draw identical data —
the comparison is like-for-like.

## How they were compared

`/compare/` loads one snapshot URL and opens each candidate with that snapshot
propagated through the shared `snapshotUrl` contract
(`resolveSnapshotUrlFromParams`), as launcher cards and as side-by-side
`<iframe>`s. Evaluation used the default published snapshot (2,461 inputs, 1,655
hidden, 1 output, 21,492 synapses).

## Scoring against the three goals (+ phone, + future growth)

Scores are 1 (weak) – 5 (strong).

| Criterion                           | Layered DAG | Sankey | Top-impact subgraph |
| ----------------------------------- | ----------- | ------ | ------------------- |
| 1. Understanding the Score          | 3           | **5**  | 4                   |
| 2. Dead zones / optimisation        | 4           | 3      | **5**               |
| 3. Troubleshooting problem neurons  | **5**       | 2      | 3                   |
| Phone-friendliness                  | 3           | 4      | **5**               |
| Future per-stock / stock-comparison | **5**       | 4      | 3                   |
| **Total**                           | **20**      | 18     | 20                  |

### Goal 1 — understanding what makes up the Score

**Sankey wins.** Band width _is_ contribution and flow is conserved, so the
Score visibly decomposes across observation families — the most direct answer to
"what makes up the Score". The subgraph shows the top contributors but not a
conserved decomposition; the DAG shows per-node impact but the whole-graph view
is dense at full scale.

### Goal 2 — finding dead zones / optimisation opportunities

**Top-impact subgraph wins.** It makes exclusion the headline: on the default
snapshot it keeps the top 12 of 2,167 aggregated nodes and reports **2,154 nodes
excluded (~15.8% of the Score)** as candidate dead zones. The DAG folds
low-impact nodes into per-column aggregates and states the collapsed/dead
counts, so it is a close second; the Sankey collapses too but frames it as flow,
not as an optimisation target.

### Goal 3 — troubleshooting problem neurons

**Layered DAG wins.** It is the only candidate with a node picker and a details
panel: select a specific neuron, read its properties and inbound/outbound
impact, and drill layer by layer. The subgraph only drills the top paths; the
Sankey is aggregate flow and weak for isolating one problem neuron.

### Phone-friendliness

All three are responsive SVG with light/dark themes. The subgraph is lightest
(one slider, few nodes); the Sankey scales cleanly but needs horizontal scroll;
the DAG carries the most controls. All are usable on a 390 px phone viewport.

### Future growth (per-stock / stock-comparison)

Every aggregate node keeps its `members`, so all three can re-expand or
re-weight per stock without a model rewrite. The DAG's layered structure plus
node selection maps most naturally onto a per-stock drill and a two-network
stock-comparison (two DAGs side by side); the Sankey extends to comparing two
stocks' Score decompositions; the subgraph to per-stock top paths.

## Recommended winner

**The layered DAG (`/dag/`) is the recommended winner** and should become the
primary replacement for the starfield. It is the only candidate that serves all
three goals without a serious weakness, it is the strongest by a clear margin on
troubleshooting (goal 3), and its node-selection model extends most naturally to
the per-stock and stock-comparison views #522 wants next. This also matches the
parent issue's steer that the DAG is the primary candidate.

The DAG and the subgraph tie on raw score, but the subgraph's strength is
concentrated in one goal (dead zones); the DAG's is spread across all three,
which is the better foundation for a single primary view.

### Keep the other two as complementary lenses

The Sankey and the subgraph are cheap to retain and each beats the DAG on the
goal where the DAG is weakest — the Sankey on Score composition (goal 1) and the
subgraph on dead-zone discovery (goal 2). Recommendation: keep all three
reachable from `/compare/`, with the DAG as the default. Retiring the starfield
is a **separate later change** (out of scope here) and must cite this evaluation
before acting.
