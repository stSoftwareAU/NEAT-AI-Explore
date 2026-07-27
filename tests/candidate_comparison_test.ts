/**
 * Side-by-side candidate comparison tests (Issue #528).
 *
 * The comparison page is the shared entry point that lists all three candidate
 * views and opens each against the *same* loaded snapshot, so they can be
 * evaluated on identical data. These tests pin the DOM-free wiring:
 *
 *   1. the chooser lists all three candidates (DAG, Sankey, top-impact subgraph);
 *   2. each candidate link propagates the loaded snapshot via the shared
 *      `snapshotUrl` query contract, so every view mounts the same data;
 *   3. the shared resolver round-trips that contract back to the same URL, so a
 *      candidate view actually loads what the comparison page linked it to.
 *
 * A candidate disappearing from the chooser, or a link that drops the snapshot,
 * fails these before merge — the failure-detection contract from the issue.
 */

import { assert, assertEquals } from "./test_helpers.ts";

import {
  buildCandidateHref,
  CANDIDATE_VIEWS,
  findCandidate,
} from "../docs/shared/candidate_views.js";
import { resolveSnapshotUrlFromParams } from "../docs/shared/snapshot_loader.js";
import { buildAggregatedGraphModel } from "../docs/shared/aggregated_graph_model.js";
import { buildSankeyFlow } from "../docs/shared/sankey_flow.js";
import { extractTopImpactSubgraph } from "../docs/shared/subgraph_model.js";

// deno-lint-ignore no-explicit-any
type Any = any;

const SNAPSHOT =
  "https://stsoftwareau.github.io/NEAT-AI-Snapshot/snapshot.json.gz";

function fixtureSnapshot(): unknown {
  return {
    tooltips: {
      "input-0": { label: "Cash rate", group: "rates" },
      "input-1": { label: "ASX 200 close", group: "equities" },
    },
    creature: {
      input: 2,
      output: 1,
      neurons: [
        { uuid: "hidden-A", type: "hidden", squash: "TANH" },
        { uuid: "output-0", type: "output", squash: "IDENTITY" },
      ],
      synapses: [
        { fromUuid: "input-0", toUuid: "hidden-A", weight: 1 },
        { fromUuid: "input-1", toUuid: "hidden-A", weight: 0.4 },
        { fromUuid: "hidden-A", toUuid: "output-0", weight: 1.2 },
      ],
    },
    derived: { impactsByNeuronUuid: { "output-0": 1, "hidden-A": 0.8 } },
  };
}

Deno.test("the chooser lists all three candidate views", () => {
  const ids = CANDIDATE_VIEWS.map((v) => v.id).sort().join(",");
  assertEquals(ids, "dag,sankey,subgraph");
  for (const view of CANDIDATE_VIEWS) {
    assert(view.label.length > 0, `${view.id} must have a label`);
    assert(view.path.startsWith("../"), `${view.id} path must be relative`);
    assert(view.tagline.length > 0, `${view.id} must have a tagline`);
  }
});

Deno.test("findCandidate resolves each id and rejects unknown ones", () => {
  assertEquals(findCandidate("dag")?.path, "../dag/");
  assertEquals(findCandidate("sankey")?.path, "../sankey/");
  assertEquals(findCandidate("subgraph")?.path, "../subgraph/");
  assertEquals(findCandidate("nope"), undefined);
});

Deno.test("each candidate link propagates the loaded snapshot", () => {
  for (const view of CANDIDATE_VIEWS) {
    const href = buildCandidateHref(view, SNAPSHOT);
    assert(href.startsWith(view.path), "href must target the view path");

    // The link must round-trip through the shared resolver back to the snapshot,
    // so the view mounts exactly the data the comparison page selected.
    const query = href.slice(href.indexOf("?"));
    const resolved = resolveSnapshotUrlFromParams(new URLSearchParams(query));
    assertEquals(resolved, SNAPSHOT);
  }
});

Deno.test("an empty snapshot leaves the view on its own default", () => {
  const dag = findCandidate("dag");
  assert(dag !== undefined, "dag candidate must exist");
  const href = buildCandidateHref(dag, "");
  assertEquals(href, "../dag/");
  assertEquals(href.includes("?"), false);
});

Deno.test("buildCandidateHref requires a path", () => {
  let threw = false;
  try {
    buildCandidateHref({ id: "x", path: "" } as Any, SNAPSHOT);
  } catch {
    threw = true;
  }
  assert(threw, "a candidate without a path must throw");
});

Deno.test("resolveSnapshotUrlFromParams round-trips and refuses dangerous schemes", () => {
  assertEquals(
    resolveSnapshotUrlFromParams(
      new URLSearchParams(`snapshotUrl=${SNAPSHOT}`),
    ),
    SNAPSHOT,
  );
  assertEquals(resolveSnapshotUrlFromParams(new URLSearchParams("")), null);

  let threw = false;
  try {
    resolveSnapshotUrlFromParams(
      new URLSearchParams("snapshotUrl=javascript:alert(1)"),
    );
  } catch {
    threw = true;
  }
  assert(threw, "a dangerous URL scheme must be refused, not returned");
});

Deno.test("all three candidate views mount against the same snapshot fixture without throwing", () => {
  // The comparison contract: one snapshot fixture drives every candidate's
  // DOM-free core. If any candidate core throws on the shared model, the
  // side-by-side comparison is broken.
  const model = buildAggregatedGraphModel(fixtureSnapshot());

  const sankey = buildSankeyFlow(model);
  assert(sankey.nodes.length > 0, "sankey must render nodes");

  // The subgraph candidate prepares its own source from the snapshot.
  const subgraph = extractTopImpactSubgraph(fixtureSnapshot());
  assert(subgraph.nodes.length > 0, "subgraph must render nodes");

  // The DAG view consumes the aggregated model's layers directly.
  assert(model.layers.length > 0, "DAG layers must be present");
});
