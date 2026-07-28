/**
 * Top-impact subgraph view tests (Issue #527).
 *
 * The subgraph view is the third candidate replacement for the 3D starfield:
 * instead of drawing everything, it extracts only the highest-contributing
 * paths to the Score and renders that compact subgraph. These tests pin the
 * contract the view depends on:
 *
 *  - top-N extraction returns a non-empty, impact-ordered set of paths that
 *    each run from an observation to the output;
 *  - the dead-zone summary is exact arithmetic — excluded = total − subgraph —
 *    so "everything not shown" is reported rather than silently dropped;
 *  - changing the N / threshold control changes the extracted set;
 *  - the extracted subgraph renders through the shared layered layout, with the
 *    observation-summary tooltips from Issue #521.
 */

import { approx, assert, assertEquals } from "./test_helpers.ts";

import { buildAggregatedGraphModel } from "../docs/shared/aggregated_graph_model.js";
import { extractTooltips } from "../docs/shared/ui_helpers.js";
import {
  computeDagLayout,
  dagLayoutToSvgString,
} from "../docs/shared/dag_layout.js";
import {
  buildSubgraphSource,
  DEFAULT_IMPACT_THRESHOLD,
  DEFAULT_TOP_PATHS,
  describeSubgraphPath,
  extractTopImpactSubgraph,
  subgraphLegendHtml,
} from "../docs/shared/subgraph_model.js";
import {
  phaseProgressPercent,
  runSubgraphDerivation,
  SUBGRAPH_PHASES,
} from "../docs/shared/subgraph_worker_client.js";
import { deriveSubgraphFromRequest } from "../docs/shared/subgraph_derivation.js";

// deno-lint-ignore no-explicit-any
type Any = any;

/**
 * Six observations across three families feeding three hidden neurons and one
 * output. The weights are deliberately graded so the contribution ranking is
 * unambiguous: input-0 ≫ input-2 ≫ input-1 ≫ input-3 ≫ input-4 ≫ input-5.
 */
function fixtureSnapshot(): Any {
  return {
    tooltips: {
      "input-0": {
        label: "Cash rate",
        group: "rates",
        description: "RBA overnight cash rate",
      },
      "input-1": {
        label: "Bond yield",
        group: "rates",
        description: "10-year Commonwealth bond yield",
      },
      "input-2": {
        label: "ASX 200 close",
        group: "equities",
        description: "Daily close of the ASX 200 index",
      },
      "input-3": {
        label: "ASX 200 volume",
        group: "equities",
        description: "Daily traded volume of the ASX 200",
      },
      "input-4": {
        label: "Credit spread",
        group: "credit",
        description: "Investment-grade credit spread",
      },
      "input-5": {
        label: "Default rate",
        group: "credit",
        description: "Trailing corporate default rate",
      },
    },
    creature: {
      input: 6,
      output: 1,
      neurons: [
        { uuid: "hidden-A", type: "hidden", squash: "TANH", bias: 0 },
        { uuid: "hidden-B", type: "hidden", squash: "TANH", bias: 0 },
        { uuid: "hidden-C", type: "hidden", squash: "TANH", bias: 0 },
        { uuid: "output-0", type: "output", squash: "IDENTITY", bias: 0 },
      ],
      synapses: [
        { fromUuid: "input-0", toUuid: "hidden-A", weight: 2 },
        { fromUuid: "input-1", toUuid: "hidden-A", weight: 0.5 },
        { fromUuid: "input-2", toUuid: "hidden-B", weight: 1.5 },
        { fromUuid: "input-3", toUuid: "hidden-B", weight: 0.2 },
        { fromUuid: "input-4", toUuid: "hidden-C", weight: 0.05 },
        { fromUuid: "input-5", toUuid: "hidden-C", weight: 0.01 },
        { fromUuid: "hidden-A", toUuid: "output-0", weight: 1.5 },
        { fromUuid: "hidden-B", toUuid: "output-0", weight: -1 },
        { fromUuid: "hidden-C", toUuid: "output-0", weight: 0.02 },
      ],
    },
    derived: {
      impactsByNeuronUuid: {
        "output-0": 1,
        "hidden-A": 0.6,
        "hidden-B": 0.39,
        "hidden-C": 0.008,
      },
    },
  };
}

function source(snapshot: Any = fixtureSnapshot()): Any {
  return buildSubgraphSource(snapshot);
}

// ---------------------------------------------------------------------------
// (a) Top-N extraction: non-empty and impact-ordered.
// ---------------------------------------------------------------------------

Deno.test("extractTopImpactSubgraph returns a non-empty, impact-ordered subgraph", () => {
  const subgraph = extractTopImpactSubgraph(source(), { topPaths: 4 });

  assert(
    subgraph.paths.length > 0,
    "extraction should find contributing paths",
  );
  assert(subgraph.nodes.length > 0, "extraction should keep renderable nodes");
  assert(subgraph.edges.length > 0, "extraction should keep renderable edges");

  for (let i = 1; i < subgraph.paths.length; i++) {
    assert(
      subgraph.paths[i - 1].score >= subgraph.paths[i].score,
      `paths must be ordered by descending impact, got ${
        subgraph.paths[i - 1].score
      } before ${subgraph.paths[i].score}`,
    );
  }
});

Deno.test("every extracted path runs from an observation to the output", () => {
  const subgraph = extractTopImpactSubgraph(source(), { topPaths: 6 });
  for (const path of subgraph.paths as Any[]) {
    assert(
      path.path[0].startsWith("input-"),
      `path should start at an observation, got ${path.path[0]}`,
    );
    assertEquals(
      path.path[path.path.length - 1],
      "output-0",
      "path should end at the output neuron",
    );
    assertEquals(path.inputUuid, path.path[0]);
    assert(path.hops >= 1, "a path should record at least one hop");
  }
});

Deno.test("top-2 extraction keeps exactly the two strongest observations", () => {
  const subgraph = extractTopImpactSubgraph(source(), {
    topPaths: 2,
    impactThreshold: 0,
  });
  assertEquals(subgraph.paths.length, 2);
  assertEquals(
    subgraph.paths.map((p: Any) => p.inputUuid).join(","),
    "input-0,input-2",
    "the two strongest contributors drive hidden-A and hidden-B",
  );
});

Deno.test("extracted nodes and edges are a consistent subset of the aggregated model", () => {
  const src = source();
  const subgraph = extractTopImpactSubgraph(src, { topPaths: 3 });

  const modelNodeIds = new Set(src.model.nodes.map((n: Any) => n.id));
  const keptIds = new Set(subgraph.nodes.map((n: Any) => n.id));
  assert(
    subgraph.nodes.length < src.model.nodes.length,
    "a top-3 subgraph must be smaller than the whole aggregated model",
  );
  for (const node of subgraph.nodes as Any[]) {
    assert(modelNodeIds.has(node.id), `${node.id} is not a model node`);
  }
  for (const edge of subgraph.edges as Any[]) {
    assert(keptIds.has(edge.from), `dangling edge source ${edge.from}`);
    assert(keptIds.has(edge.to), `dangling edge target ${edge.to}`);
  }
});

Deno.test("the output node is always part of the extracted subgraph", () => {
  const subgraph = extractTopImpactSubgraph(source(), { topPaths: 1 });
  const outputIds = subgraph.meta.outputNodeIds as string[];
  assert(outputIds.length > 0, "subgraph should report its output node");
  const keptIds = new Set(subgraph.nodes.map((n: Any) => n.id));
  for (const id of outputIds) {
    assert(keptIds.has(id), `output node ${id} must be rendered`);
  }
});

Deno.test("extraction groups observations into families via the aggregated model", () => {
  const subgraph = extractTopImpactSubgraph(source(), { topPaths: 2 });
  const familyNodes = subgraph.nodes.filter((n: Any) => n.kind === "family");
  assertEquals(
    familyNodes.map((n: Any) => n.id).sort().join(","),
    "family:equities,family:rates",
    "top-2 paths enter through the rates and equities families",
  );
});

// ---------------------------------------------------------------------------
// (b) Dead-zone summary — exact arithmetic, nothing silently dropped.
// ---------------------------------------------------------------------------

Deno.test("dead-zone counts equal total minus subgraph, for nodes and neurons", () => {
  const subgraph = extractTopImpactSubgraph(source(), { topPaths: 2 });
  const dz = subgraph.deadZone;

  assertEquals(
    dz.excludedNodes,
    dz.totalNodes - dz.subgraphNodes,
    "excluded node count must be total minus subgraph",
  );
  assertEquals(
    dz.excludedNeurons,
    dz.totalNeurons - dz.subgraphNeurons,
    "excluded neuron count must be total minus subgraph",
  );
  assertEquals(
    dz.excludedObservations,
    dz.totalObservations - dz.subgraphObservations,
    "excluded observation count must be total minus subgraph",
  );
  assert(
    dz.excludedNeurons > 0,
    "a top-2 subgraph of a 10-neuron network must report a dead zone",
  );
  assertEquals(
    dz.subgraphObservations,
    2,
    "two selected paths mean two contributing observations",
  );
  assertEquals(dz.totalObservations, 6);
});

Deno.test("widening the extraction shrinks the dead zone", () => {
  const src = source();
  const narrow = extractTopImpactSubgraph(src, {
    topPaths: 2,
    impactThreshold: 0,
  });
  const wide = extractTopImpactSubgraph(src, {
    topPaths: 6,
    impactThreshold: 0,
  });
  assert(
    wide.deadZone.excludedNeurons < narrow.deadZone.excludedNeurons,
    "including more paths must leave fewer neurons in the dead zone",
  );
  assertEquals(wide.deadZone.excludedObservations, 0);
});

Deno.test("unreachable neurons are reported separately as a hard dead zone", () => {
  const snapshot = fixtureSnapshot();
  // A neuron that feeds nothing can never influence the Score.
  snapshot.creature.neurons.push({
    uuid: "hidden-orphan",
    type: "hidden",
    squash: "TANH",
    bias: 0,
  });
  const subgraph = extractTopImpactSubgraph(buildSubgraphSource(snapshot), {
    topPaths: 6,
  });
  assertEquals(
    subgraph.deadZone.unreachableNeurons,
    1,
    "the orphan neuron has no path to the output",
  );
});

// ---------------------------------------------------------------------------
// (c) The N / threshold control changes the extracted set.
// ---------------------------------------------------------------------------

Deno.test("changing N changes the extracted set", () => {
  const src = source();
  const two = extractTopImpactSubgraph(src, {
    topPaths: 2,
    impactThreshold: 0,
  });
  const six = extractTopImpactSubgraph(src, {
    topPaths: 6,
    impactThreshold: 0,
  });

  assertEquals(two.paths.length, 2);
  assertEquals(six.paths.length, 6);
  assert(
    six.nodes.length > two.nodes.length,
    `a wider N must render more nodes (${six.nodes.length} vs ${two.nodes.length})`,
  );
  assertEquals(two.meta.topPaths, 2);
  assertEquals(six.meta.topPaths, 6);
});

Deno.test("raising the impact threshold drops the weakest paths", () => {
  const src = source();
  const all = extractTopImpactSubgraph(src, {
    topPaths: 100,
    impactThreshold: 0,
  });
  const strong = extractTopImpactSubgraph(src, {
    topPaths: 100,
    impactThreshold: 0.1,
  });

  assert(
    strong.paths.length < all.paths.length,
    "a 10% threshold must exclude the weak contributors",
  );
  for (const path of strong.paths as Any[]) {
    assert(
      path.score >= 0.1,
      `every retained path must clear the threshold, got ${path.score}`,
    );
  }
  assertEquals(strong.meta.impactThreshold, 0.1);
});

Deno.test("a threshold above every score yields an explicit empty subgraph", () => {
  // An empty result is a legitimate control setting, not a fault: it must be
  // reported honestly (with the whole network in the dead zone) rather than
  // throwing or quietly falling back to the strongest path.
  const src = source();
  const subgraph = extractTopImpactSubgraph(src, { impactThreshold: 1.5 });
  assertEquals(subgraph.paths.length, 0);
  assertEquals(subgraph.nodes.length, 0);
  assertEquals(subgraph.edges.length, 0);
  assertEquals(subgraph.deadZone.subgraphNeurons, 0);
  assertEquals(
    subgraph.deadZone.excludedNeurons,
    subgraph.deadZone.totalNeurons,
  );
});

Deno.test("a multi-output network sums each observation's contribution across outputs", () => {
  const snapshot = fixtureSnapshot();
  snapshot.creature.output = 2;
  snapshot.creature.neurons.push({
    uuid: "output-1",
    type: "output",
    squash: "IDENTITY",
    bias: 0,
  });
  snapshot.creature.synapses.push(
    { fromUuid: "hidden-B", toUuid: "output-1", weight: 1 },
    { fromUuid: "hidden-C", toUuid: "output-1", weight: 1 },
  );

  const subgraph = extractTopImpactSubgraph(buildSubgraphSource(snapshot), {
    topPaths: 100,
    impactThreshold: 0,
  });
  const total = subgraph.paths.reduce(
    (acc: number, p: Any) => acc + p.score,
    0,
  );
  approx(total, 1, 1e-9, "shares must stay normalised across both outputs");

  const outputs = new Set(
    subgraph.paths.map((p: Any) => p.path[p.path.length - 1]),
  );
  for (const uuid of outputs) {
    assert(
      uuid === "output-0" || uuid === "output-1",
      `every illustrated path must end at an output, got ${uuid}`,
    );
  }
  assertEquals(
    (subgraph.meta.outputNodeIds as string[]).length >= 1,
    true,
    "at least one output node must be rendered",
  );
});

Deno.test("the extraction defaults are usable without any options", () => {
  const subgraph = extractTopImpactSubgraph(source());
  assertEquals(subgraph.meta.topPaths, DEFAULT_TOP_PATHS);
  assertEquals(subgraph.meta.impactThreshold, DEFAULT_IMPACT_THRESHOLD);
  assert(subgraph.paths.length > 0, "defaults must render something");
});

Deno.test("extractTopImpactSubgraph accepts a raw snapshot as well as a source", () => {
  const fromSnapshot = extractTopImpactSubgraph(fixtureSnapshot(), {
    topPaths: 3,
  });
  const fromSource = extractTopImpactSubgraph(source(), { topPaths: 3 });
  assertEquals(
    fromSnapshot.paths.map((p: Any) => p.inputUuid).join(","),
    fromSource.paths.map((p: Any) => p.inputUuid).join(","),
  );
});

// ---------------------------------------------------------------------------
// (d) Failure surfaces loudly.
// ---------------------------------------------------------------------------

Deno.test("buildSubgraphSource throws when the snapshot carries no creature", () => {
  let threw = false;
  try {
    buildSubgraphSource({});
  } catch {
    threw = true;
  }
  assert(threw, "a missing creature is a fault to surface, not an empty model");
});

Deno.test("buildSubgraphSource throws when no observation reaches the output", () => {
  const snapshot = fixtureSnapshot();
  // Strip the observation layer: the hidden neurons still feed the output but
  // nothing upstream can be attributed, so there is no subgraph to show.
  snapshot.creature.synapses = snapshot.creature.synapses.filter((
    s: Any,
  ) => !s.fromUuid.startsWith("input-"));
  let message = "";
  try {
    buildSubgraphSource(snapshot);
  } catch (e) {
    message = (e as Error).message;
  }
  assert(
    message.includes("output"),
    `expected a loud failure naming the output, got: ${message}`,
  );
});

// ---------------------------------------------------------------------------
// (e) Rendering + tooltips (Issue #521 parity).
// ---------------------------------------------------------------------------

Deno.test("the extracted subgraph renders through the shared layered layout", () => {
  const subgraph = extractTopImpactSubgraph(source(), { topPaths: 4 });
  const layout = computeDagLayout(subgraph, { snapshot: fixtureSnapshot() });
  const svg = dagLayoutToSvgString(layout);

  assertEquals(layout.nodes.length, subgraph.nodes.length);
  assertEquals(layout.edges.length, subgraph.edges.length);
  assert(svg.startsWith("<svg"), "should render an <svg> root");
  assertEquals(
    (svg.match(/class="dagNode"/g) ?? []).length,
    layout.nodes.length,
  );

  const output = layout.nodes.find((n: Any) => n.isOutput);
  assert(output, "the layout should mark the output node");
  assertEquals(
    output.column,
    layout.columnCount - 1,
    "the output must stay in the right-most column",
  );
});

Deno.test("subgraph node tooltips carry the observation summaries (Issue #521)", () => {
  const snapshot = fixtureSnapshot();
  const { labels, descriptions } = extractTooltips(snapshot);
  const subgraph = extractTopImpactSubgraph(buildSubgraphSource(snapshot), {
    topPaths: 2,
  });
  const layout = computeDagLayout(subgraph, { snapshot });

  const rates = layout.nodes.find((n: Any) => n.id === "family:rates") as Any;
  assert(rates, "the rates family should be on a top path");
  assert(
    rates.tooltip.includes(labels["input-0"]),
    `tooltip should include the observation label, got: ${rates.tooltip}`,
  );
  assert(
    rates.tooltip.includes(descriptions["input-0"]),
    `tooltip should include the Tooltips.json summary, got: ${rates.tooltip}`,
  );
});

Deno.test("describeSubgraphPath renders the observation summary, share and hops", () => {
  const snapshot = fixtureSnapshot();
  const { labels, descriptions } = extractTooltips(snapshot);
  const subgraph = extractTopImpactSubgraph(buildSubgraphSource(snapshot), {
    topPaths: 1,
  });
  const text = describeSubgraphPath(subgraph.paths[0], {
    labels,
    descriptions,
  });

  assert(
    text.includes("Cash rate — RBA overnight cash rate"),
    `should use buildObservationTooltip formatting, got: ${text}`,
  );
  assert(text.includes("%"), "should report the share of the Score");
  assert(text.includes("hop"), "should report the path length");
  assert(
    text.includes("input-0 → hidden-A → output-0"),
    `should spell out the path, got: ${text}`,
  );
});

Deno.test("describeSubgraphPath degrades to the uuid when no summary is known", () => {
  const text = describeSubgraphPath({
    inputUuid: "input-9",
    score: 0.25,
    path: ["input-9", "output-0"],
    hops: 1,
  }, {});
  assert(text.includes("input-9"), "should still name the observation");
  assert(text.includes("25.0%"), "should still report the share");
});

Deno.test("subgraphLegendHtml explains the impact encodings and the dead zone", () => {
  const html = subgraphLegendHtml();
  assert(html.includes("<dl"), "legend should be a definition list");
  assert(
    html.toLowerCase().includes("dead zone"),
    "the legend must name the dead zone the view excludes",
  );
});

Deno.test("extraction is deterministic for the same source and controls", () => {
  const src = source();
  const a = extractTopImpactSubgraph(src, { topPaths: 4 });
  const b = extractTopImpactSubgraph(src, { topPaths: 4 });
  assertEquals(
    JSON.stringify(a.paths),
    JSON.stringify(b.paths),
    "the same controls must select the same paths",
  );
  assertEquals(
    dagLayoutToSvgString(computeDagLayout(a)),
    dagLayoutToSvgString(computeDagLayout(b)),
    "the same subgraph must render identical SVG",
  );
});

// ---------------------------------------------------------------------------
// (f) Off-main-thread derivation with honest progress (Issue #560).
//
// The page must not run buildSubgraphSource synchronously on the main thread:
// the whole download → gunzip → parse → rank derivation is dispatched to a Web
// Worker, driven by `runSubgraphDerivation`, and each phase advances the
// progress bar honestly. A swallowed worker error must surface loudly.
// ---------------------------------------------------------------------------

/** Minimal structured-worker double: scripts a message/error sequence. */
class FakeWorker {
  // deno-lint-ignore no-explicit-any
  private listeners: Record<string, Array<(ev: any) => void>> = {};
  // deno-lint-ignore no-explicit-any
  posted: any[] = [];
  terminated = false;

  constructor(
    private script: (
      api: { message: (m: Any) => void; error: (m: string) => void },
    ) => void,
  ) {}

  // deno-lint-ignore no-explicit-any
  addEventListener(type: string, fn: (ev: any) => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  // deno-lint-ignore no-explicit-any
  removeEventListener(type: string, fn: (ev: any) => void) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn);
  }
  // deno-lint-ignore no-explicit-any
  private emit(type: string, ev: any) {
    for (const fn of [...(this.listeners[type] ?? [])]) fn(ev);
  }
  // deno-lint-ignore no-explicit-any
  postMessage(msg: any) {
    this.posted.push(msg);
    const api = {
      message: (m: Any) => this.emit("message", { data: m }),
      error: (m: string) => this.emit("error", { message: m }),
    };
    // Mimic a real worker: the round-trip is asynchronous.
    queueMicrotask(() => this.script(api));
  }
  terminate() {
    this.terminated = true;
  }
}

Deno.test("phaseProgressPercent advances monotonically through every phase", () => {
  // Each phase entry (fraction 0) must be a distinct forward step, so the bar
  // never stalls or moves backwards across download → gunzip → parse → rank.
  const entries = SUBGRAPH_PHASES.map((p: string) =>
    phaseProgressPercent(p as Any, 0)
  );
  for (let i = 1; i < entries.length; i++) {
    assert(
      entries[i] > entries[i - 1],
      `phase ${SUBGRAPH_PHASES[i]} (${entries[i]}%) must advance past ${
        SUBGRAPH_PHASES[i - 1]
      } (${entries[i - 1]}%)`,
    );
  }
  // Download interpolates within its own slice and stays ordered.
  assert(
    phaseProgressPercent("download", 0.5) > phaseProgressPercent("download", 0),
  );
  assert(
    phaseProgressPercent("download", 1) <= phaseProgressPercent("gunzip", 0),
    "a full download must not overtake the gunzip phase",
  );
  assertEquals(phaseProgressPercent("rank", 1), 100, "rank completes the bar");
  // Out-of-range fractions clamp rather than escaping the phase slice.
  assertEquals(
    phaseProgressPercent("download", 5),
    phaseProgressPercent("download", 1),
  );
});

Deno.test("runSubgraphDerivation returns the worker's result via a message round-trip", async () => {
  const phases: string[] = [];
  const progress: number[] = [];
  const sentinel = { source: { rankedPaths: [{ inputUuid: "input-0" }] } };

  const worker = new FakeWorker(({ message }) => {
    message({ type: "phase", phase: "download" });
    message({ type: "progress", receivedBytes: 50, totalBytes: 100 });
    message({ type: "phase", phase: "gunzip" });
    message({ type: "phase", phase: "parse" });
    message({ type: "phase", phase: "rank" });
    message({ type: "done", result: sentinel });
  });

  const request = { type: "url", url: "https://example.test/snap.json.gz" };
  const result = await runSubgraphDerivation(worker as Any, request as Any, {
    onPhase: (p: string) => phases.push(p),
    onProgress: (p: Any) => progress.push(p.receivedBytes / p.totalBytes),
  });

  // The derivation result came back across the worker boundary — the page did
  // not compute it synchronously.
  assertEquals(result, sentinel);
  assertEquals(
    worker.posted[0],
    request,
    "the request is posted to the worker",
  );
  assertEquals(
    phases.join(","),
    "download,gunzip,parse,rank",
    "each phase must fire once, in order",
  );
  assertEquals(progress.length, 1, "download progress is reported");
});

Deno.test("runSubgraphDerivation surfaces a worker error message loudly", async () => {
  const worker = new FakeWorker(({ message }) => {
    message({ type: "phase", phase: "download" });
    message({ type: "error", message: "gunzip failed: corrupt stream" });
  });

  let caught: Error | null = null;
  try {
    await runSubgraphDerivation(worker as Any, { type: "url", url: "x" });
  } catch (e) {
    caught = e as Error;
  }
  assert(caught, "a worker error must reject, not resolve silently");
  assert(
    caught!.message.includes("corrupt stream"),
    `the loud error must carry the worker message, got: ${caught?.message}`,
  );
});

Deno.test("runSubgraphDerivation rejects on a worker 'error' event", async () => {
  const worker = new FakeWorker(({ error }) => {
    error("Worker script failed to import");
  });

  let caught: Error | null = null;
  try {
    await runSubgraphDerivation(worker as Any, { type: "url", url: "x" });
  } catch (e) {
    caught = e as Error;
  }
  assert(caught, "an error event must reject rather than hang the spinner");
  assert(caught!.message.includes("import"));
});

// -- The real DOM-free pipeline: honest phases end-to-end ---------------------

/** Gzip a string with the platform CompressionStream (Deno + browsers). */
async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([new TextEncoder().encode(text)]).stream()
    .pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

Deno.test("deriveSubgraphFromRequest walks download→gunzip→parse→rank for a URL", async () => {
  const gz = await gzip(JSON.stringify(fixtureSnapshot()));
  const savedFetch = globalThis.fetch;
  const phases: string[] = [];
  try {
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(gz as Any, {
          status: 200,
          headers: {
            "content-type": "application/gzip",
            "content-length": String(gz.length),
          },
        }),
      );

    const result = await deriveSubgraphFromRequest(
      { type: "url", url: "https://example.test/snap.json.gz" },
      { onPhase: (p: string) => phases.push(p) },
    );

    assertEquals(
      phases.join(","),
      "download,gunzip,parse,rank",
      "every phase must report exactly once, in order",
    );
    assert(
      result.source.rankedPaths.length > 0,
      "the ranked source must come back from the pipeline",
    );
    assertEquals(
      result.labels["input-0"],
      "Cash rate",
      "observation tooltips are derived alongside the source",
    );
  } finally {
    globalThis.fetch = savedFetch;
  }
});

Deno.test("deriveSubgraphFromRequest walks gunzip→parse→rank for an uploaded .gz file", async () => {
  const gz = await gzip(JSON.stringify(fixtureSnapshot()));
  const file = new File([gz as Any], "snapshot.json.gz");
  const phases: string[] = [];

  const result = await deriveSubgraphFromRequest(
    { type: "file", file },
    { onPhase: (p: string) => phases.push(p) },
  );

  assertEquals(
    phases.join(","),
    "gunzip,parse,rank",
    "a local file skips download but still reports its phases",
  );
  assert(result.source.rankedPaths.length > 0);
});

Deno.test("deriveSubgraphFromRequest fails loud when the download fails", async () => {
  const savedFetch = globalThis.fetch;
  try {
    globalThis.fetch = () =>
      Promise.resolve(new Response("nope", { status: 500 }));

    let caught: Error | null = null;
    try {
      await deriveSubgraphFromRequest({
        type: "url",
        url: "https://example.test/snap.json.gz",
      });
    } catch (e) {
      caught = e as Error;
    }
    assert(caught, "a failed download must throw, never yield an empty result");
    assert(
      caught!.message.includes("500"),
      `the error must name the fault, got: ${caught?.message}`,
    );
  } finally {
    globalThis.fetch = savedFetch;
  }
});

Deno.test("path shares are normalised against the whole ranked set", () => {
  const src = source();
  const all = extractTopImpactSubgraph(src, {
    topPaths: 100,
    impactThreshold: 0,
  });
  const total = all.paths.reduce((acc: number, p: Any) => acc + p.score, 0);
  approx(total, 1, 1e-9, "every contributing path should sum to the Score");

  // The aggregated model the subgraph is carved from is shared, not rebuilt.
  const subgraph = extractTopImpactSubgraph(src, { topPaths: 1 });
  assertEquals(
    src.model.nodes.length,
    buildAggregatedGraphModel(fixtureSnapshot(), { collapseThreshold: 0 })
      .nodes.length,
    "the source model must be the full aggregated model",
  );
  assert(subgraph.nodes.length > 0);
});
