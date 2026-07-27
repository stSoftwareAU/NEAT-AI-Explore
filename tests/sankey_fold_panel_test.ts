/**
 * Sankey folded-tail inspector tests (Issue #538).
 *
 * The per-layer fold in `sankey_flow.js` keeps the diagram readable by
 * collapsing each layer's tail into one opaque "other" band — but that tail is
 * exactly where the thin and absent flows live, so dead-zone discovery (#526)
 * was impossible from this view. These tests pin the contract that makes the
 * fold inspectable:
 *
 *   1. selecting a folded node lists what was folded, weakest first, with each
 *      member's share of the Score, and no member silently lost;
 *   2. members carrying no flow are marked dead, not merely minor;
 *   3. a 2,128-member fold renders one bounded page at a time, and the pager
 *      walks the list without ever putting the whole fold in the DOM;
 *   4. the published page really declares the panel the view drives.
 */

import { assert, assertEquals } from "./test_helpers.ts";
import { loadDocument, parseHtml } from "./dom_helpers.ts";

import { buildAggregatedGraphModel } from "../docs/shared/aggregated_graph_model.js";
import {
  buildSankeyFlow,
  DEFAULT_FOLDED_TAIL_PAGE_SIZE,
  rankFoldedTail,
} from "../docs/shared/sankey_flow.js";
import {
  attachFoldPanelDismissers,
  attachFoldTrigger,
  createFoldPanelController,
  formatSharePercent,
  summariseFoldedTail,
} from "../docs/sankey/fold_panel.js";

// deno-lint-ignore no-explicit-any
type Any = any;

const PAGE_MARKUP = `<!DOCTYPE html><html><body>
  <div id="diagram"><g class="sankeyNode" tabindex="0"></g></div>
  <aside id="foldPanel" class="foldPanel" aria-hidden="true">
    <h2 id="foldPanelTitle"></h2>
    <button id="foldPanelClose" type="button">Close</button>
    <p id="foldPanelSummary"></p>
    <ol id="foldPanelList"></ol>
    <button id="foldPanelPrev" type="button">Previous</button>
    <span id="foldPanelPageInfo"></span>
    <button id="foldPanelNext" type="button">Next</button>
  </aside>
</body></html>`;

/**
 * A snapshot whose layer 0 folds: `minorCount` families with a small but
 * non-zero contribution and `deadCount` families wired through a zero-weight
 * synapse, which contribute nothing at all.
 */
function foldedTailSnapshot(minorCount: number, deadCount: number): unknown {
  const tooltips: Record<string, unknown> = {};
  const synapses: Array<Record<string, unknown>> = [
    { fromUuid: "hidden-A", toUuid: "output-0", weight: 1 },
  ];
  const total = minorCount + deadCount;
  for (let i = 0; i < total; i++) {
    const isDead = i >= minorCount;
    tooltips[`input-${i}`] = {
      label: `Signal ${i}`,
      description: `Independent signal ${i}`,
      group: isDead ? `dead ${i}` : `sig ${i}`,
    };
    synapses.push({
      fromUuid: `input-${i}`,
      toUuid: "hidden-A",
      weight: isDead ? 0 : 1 / (i + 1),
    });
  }
  return {
    tooltips,
    creature: {
      input: total,
      output: 1,
      neurons: [
        { uuid: "hidden-A", type: "hidden", squash: "TANH" },
        { uuid: "output-0", type: "output", squash: "IDENTITY" },
      ],
      synapses,
    },
    derived: { impactsByNeuronUuid: { "output-0": 1, "hidden-A": 1 } },
  };
}

function foldFixture(minorCount = 20, deadCount = 6) {
  const flow = buildSankeyFlow(
    buildAggregatedGraphModel(foldedTailSnapshot(minorCount, deadCount)),
  ) as Any;
  const node = flow.nodes.find((n: Any) => n.kind === "other");
  assert(node, "the fixture must fold layer 0 into an 'other' node");
  const doc = parseHtml(PAGE_MARKUP);
  const controller = createFoldPanelController(doc);
  return { flow, node, doc, controller };
}

/** Look up a panel element, failing the test if the markup lost it. */
function el(doc: Any, id: string): Any {
  const found = doc.getElementById(id);
  assert(found, `#${id} must exist in the panel markup`);
  return found;
}

function rows(doc: Any): Any[] {
  return Array.from(el(doc, "foldPanelList").children) as Any[];
}

function click(el: Any): void {
  el.dispatchEvent(new Event("click", { bubbles: true }));
}

Deno.test("selecting a folded node lists what was folded, weakest first", () => {
  const f = foldFixture(20, 6);
  assertEquals(f.controller.isOpen(), false, "the panel starts closed");

  const total = f.controller.open(f.node, { totalScore: f.flow.totalScore });

  assert(f.controller.isOpen(), "opening a fold must show the panel");
  assertEquals(el(f.doc, "foldPanel").getAttribute("aria-hidden"), "false");
  // No folded member is lost: the list total is the node's own fold count.
  assertEquals(total, f.node.otherCount);
  assert(
    el(f.doc, "foldPanelSummary").textContent.includes(
      `${f.node.otherCount} folded members`,
    ),
    "the summary must report how many members were folded",
  );

  const listed = rows(f.doc);
  assertEquals(listed.length, f.node.otherCount);

  // Weakest first, and every row states its share of the Score.
  const ranked = rankFoldedTail(f.node, { totalScore: f.flow.totalScore });
  assertEquals(
    listed[0].querySelector(".foldRowLabel").textContent,
    ranked.entries[0].label,
  );
  const live = listed.filter((li) =>
    !li.getAttribute("class").includes("isDead")
  );
  for (const li of live) {
    assert(
      /of the Score$/.test(li.querySelector(".foldRowShare").textContent),
      "a live member must show its share of the Score",
    );
  }
});

Deno.test("members with no flow are marked dead, not merely minor", () => {
  const f = foldFixture(20, 6);
  f.controller.open(f.node, { totalScore: f.flow.totalScore });

  const listed = rows(f.doc);
  const dead = listed.filter((li) =>
    li.getAttribute("class").includes("isDead")
  );
  assertEquals(dead.length, 6);
  for (const li of dead) {
    assertEquals(
      li.querySelector(".foldRowShare").textContent,
      "no flow — dead",
    );
  }
  // Dead members lead the list — the dead zones are what the viewer came for.
  for (let i = 0; i < dead.length; i++) {
    assert(
      listed[i].getAttribute("class").includes("isDead"),
      "dead members must be listed before the merely minor ones",
    );
  }
  assert(
    el(f.doc, "foldPanelSummary").textContent.includes(
      "6 with no flow (dead)",
    ),
    "the summary must call out the dead members",
  );
});

Deno.test("a 2,128-member fold renders one bounded page at a time", () => {
  const f = foldFixture(2000, 140);
  const total = f.controller.open(f.node, { totalScore: f.flow.totalScore });
  assertEquals(total, 2128);

  // The whole fold is never in the DOM — that is what keeps a phone alive.
  assertEquals(rows(f.doc).length, DEFAULT_FOLDED_TAIL_PAGE_SIZE);
  assertEquals(
    el(f.doc, "foldPanelPageInfo").textContent,
    `1–${DEFAULT_FOLDED_TAIL_PAGE_SIZE} of ${total}`,
  );
  assertEquals(
    el(f.doc, "foldPanelPrev").getAttribute("disabled"),
    "",
    "the first page has no previous page",
  );
  assertEquals(el(f.doc, "foldPanelNext").getAttribute("disabled"), null);

  click(el(f.doc, "foldPanelNext"));
  assertEquals(rows(f.doc).length, DEFAULT_FOLDED_TAIL_PAGE_SIZE);
  assertEquals(
    el(f.doc, "foldPanelPageInfo").textContent,
    `51–100 of ${total}`,
  );
  assertEquals(el(f.doc, "foldPanelPrev").getAttribute("disabled"), null);

  click(el(f.doc, "foldPanelPrev"));
  assertEquals(
    el(f.doc, "foldPanelPageInfo").textContent,
    `1–${DEFAULT_FOLDED_TAIL_PAGE_SIZE} of ${total}`,
  );

  // The last page is short and ends the walk.
  f.controller.showPage(total - 1);
  assert(rows(f.doc).length <= DEFAULT_FOLDED_TAIL_PAGE_SIZE);
  assertEquals(el(f.doc, "foldPanelNext").getAttribute("disabled"), "");
});

Deno.test("activating a folded node opens the list by click and by keyboard", () => {
  const f = foldFixture(20, 6);
  const group = f.doc.querySelector(".sankeyNode") as Any;
  attachFoldTrigger(group, f.node, f.controller, {
    totalScore: f.flow.totalScore,
  });

  click(group);
  assert(f.controller.isOpen(), "clicking a folded node must open the list");
  assertEquals(f.controller.nodeId(), f.node.id);

  f.controller.close();
  assertEquals(f.controller.isOpen(), false);

  const key = new Event("keydown", { bubbles: true }) as Any;
  key.key = "Enter";
  group.dispatchEvent(key);
  assert(f.controller.isOpen(), "Enter must open the list for keyboard users");
});

Deno.test("the list closes on the close button and on Escape", () => {
  const f = foldFixture(20, 6);
  attachFoldPanelDismissers(f.doc, f.controller);

  f.controller.open(f.node, { totalScore: f.flow.totalScore });
  click(el(f.doc, "foldPanelClose"));
  assertEquals(f.controller.isOpen(), false, "the close button must dismiss");
  assertEquals(rows(f.doc).length, 0, "closing must clear the rendered page");

  f.controller.open(f.node, { totalScore: f.flow.totalScore });
  const escape = new Event("keydown", { bubbles: true }) as Any;
  escape.key = "Escape";
  f.doc.dispatchEvent(escape);
  assertEquals(f.controller.isOpen(), false, "Escape must dismiss");
});

Deno.test("a thin contribution is never displayed as zero", () => {
  assertEquals(formatSharePercent(0), "0%");
  assertEquals(formatSharePercent(-1), "0%");
  assertEquals(formatSharePercent(Number.NaN), "0%");
  // Rounding a live flow to "0.00%" would read as dead — it must not.
  assertEquals(formatSharePercent(1e-9), "<0.01%");
  assertEquals(formatSharePercent(0.1234), "12.34%");
});

Deno.test("an unrankable fold says so instead of inventing dead zones", () => {
  // No impact anywhere in the tail but flow through the band: there is no
  // ranking signal, so the split is even and nothing is called dead.
  const node = {
    id: "other:layer-0",
    kind: "other",
    label: "3 minor observation families",
    value: 0.3,
    otherCount: 3,
    foldedNodes: [
      { id: "family:a", kind: "family", label: "A", impact: 0, memberCount: 1 },
      { id: "family:b", kind: "family", label: "B", impact: 0, memberCount: 1 },
      { id: "family:c", kind: "family", label: "C", impact: 0, memberCount: 1 },
    ],
  };
  const ranked = rankFoldedTail(node, { totalScore: 1 }) as Any;
  assertEquals(ranked.basis, "even");
  assertEquals(ranked.deadCount, 0);
  assert(summariseFoldedTail(ranked).includes("no impact attributed"));

  const doc = parseHtml(PAGE_MARKUP);
  const controller = createFoldPanelController(doc);
  controller.open(node, { totalScore: 1 });
  assertEquals(rows(doc).length, 3);
});

Deno.test("a missing panel fails loudly rather than dropping the fold silently", () => {
  const doc = parseHtml(
    `<!DOCTYPE html><html><body><div id="diagram"></div></body></html>`,
  );
  let threw = false;
  try {
    createFoldPanelController(doc);
  } catch {
    threw = true;
  }
  assert(threw, "missing panel markup must throw, not silently no-op");
});

Deno.test("the published Sankey page declares the fold panel the view drives", async () => {
  const doc = await loadDocument(
    new URL("../docs/sankey/index.html", import.meta.url),
  );
  // Building the controller from the real page fails if any element is renamed
  // or removed, so the markup cannot drift away from the view.
  const controller = createFoldPanelController(doc as unknown as Any);
  assertEquals(controller.isOpen(), false);

  const panel = doc.getElementById("foldPanel")!;
  assertEquals(panel.getAttribute("aria-hidden"), "true");
  assertEquals(panel.getAttribute("aria-labelledby"), "foldPanelTitle");
});
