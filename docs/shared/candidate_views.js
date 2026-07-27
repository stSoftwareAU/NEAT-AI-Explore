/**
 * Candidate replacement graph views (Issue #528).
 *
 * The single source of truth for the three candidate views built side by side
 * to replace the 3D starfield (parent #522). The comparison page renders one
 * card per entry and links each to its view with the *same* loaded snapshot, so
 * they are evaluated against identical data.
 *
 * DOM-free and deterministic so the wiring is unit-tested
 * (`tests/candidate_comparison_test.ts`) without a browser.
 *
 * Australian English throughout (behaviour, colour, optimisation).
 */

/**
 * @typedef {object} CandidateView
 * @property {string} id — stable slug (`dag` | `sankey` | `subgraph`).
 * @property {string} label — display name.
 * @property {string} path — relative path from `docs/compare/` to the view.
 * @property {string} tagline — one-line description.
 * @property {string} bestFor — which of the three #522 goals it serves best.
 */

/** @type {CandidateView[]} */
export const CANDIDATE_VIEWS = [
  {
    id: "dag",
    label: "Layered DAG",
    path: "../dag/",
    tagline: "Layered 2D directed graph with per-node impact overlay.",
    bestFor: "Troubleshooting problem neurons — drill layer by layer.",
  },
  {
    id: "sankey",
    label: "Sankey contribution flow",
    path: "../sankey/",
    tagline: "Conserved flow from observation families to the Score.",
    bestFor: "Understanding what makes up the Score.",
  },
  {
    id: "subgraph",
    label: "Top-impact subgraph",
    path: "../subgraph/",
    tagline: "Only the highest-impact paths; the rest are dead zones.",
    bestFor: "Finding dead zones / optimisation opportunities.",
  },
];

/**
 * Look up a candidate view by id.
 * @param {string} id
 * @returns {CandidateView | undefined}
 */
export function findCandidate(id) {
  return CANDIDATE_VIEWS.find((v) => v.id === id);
}

/**
 * Build the href that opens a candidate view against a given snapshot.
 *
 * When `snapshotUrl` is empty the view opens on its own default snapshot; when
 * present it is passed through the shared `snapshotUrl` query contract (see
 * `resolveSnapshotUrlFromParams`) so every view loads identical data.
 *
 * @param {CandidateView | string} view — a candidate entry or its `path`.
 * @param {string} [snapshotUrl]
 * @returns {string}
 */
export function buildCandidateHref(view, snapshotUrl) {
  const path = typeof view === "string" ? view : view?.path;
  if (!path) throw new Error("buildCandidateHref requires a candidate path");

  const trimmed = String(snapshotUrl ?? "").trim();
  if (!trimmed) return path;

  const params = new URLSearchParams();
  params.set("snapshotUrl", trimmed);
  return `${path}?${params.toString()}`;
}
