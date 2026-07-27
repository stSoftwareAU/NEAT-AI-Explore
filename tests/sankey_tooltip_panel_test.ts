/**
 * Sankey touch tooltip panel tests (Issue #536).
 *
 * `docs/sankey/index.html` declares a `#tooltip` panel and `sankey.css` styles
 * it, but until #536 nothing populated it — so on a phone, where the SVG
 * `<title>` child never renders, the #521 observation summaries were
 * unreachable. These tests pin the panel contract:
 *
 *   1. showing a node's tooltip puts *exactly* the node's `tooltip` string in
 *      the panel, so the touch path cannot drift from `buildNodeTooltip`;
 *   2. the show/hide state transitions — tap, tap-away, Escape, focus, blur;
 *   3. the panel is clamped inside a phone-width viewport.
 *
 * The panel element under test is parsed from the published page, so deleting
 * or renaming it fails here before merge.
 */

import { assert, assertEquals } from "./test_helpers.ts";
import { loadDocument, parseHtml } from "./dom_helpers.ts";

import { buildAggregatedGraphModel } from "../docs/shared/aggregated_graph_model.js";
import { buildSankeyFlow } from "../docs/shared/sankey_flow.js";
import {
  attachTooltipDismissers,
  attachTooltipTrigger,
  clampTooltipPosition,
  createTooltipController,
  TOOLTIP_MARGIN,
} from "../docs/sankey/tooltip_panel.js";

// deno-lint-ignore no-explicit-any
type Any = any;

/** Two rate observations and one equity into a single output. */
function smallSnapshot(): unknown {
  return {
    tooltips: {
      "input-0": {
        label: "Cash rate",
        description: "RBA overnight cash rate",
        group: "rates",
      },
      "input-1": {
        label: "Bond yield",
        description: "10-year AGB yield",
        group: "rates",
      },
      "input-2": {
        label: "ASX 200 close",
        description: "Daily ASX 200 close",
        group: "equities",
      },
    },
    creature: {
      input: 3,
      output: 1,
      neurons: [
        { uuid: "hidden-A", type: "hidden", squash: "TANH", bias: 0 },
        { uuid: "hidden-B", type: "hidden", squash: "TANH", bias: 0 },
        { uuid: "output-0", type: "output", squash: "IDENTITY", bias: 0 },
      ],
      synapses: [
        { fromUuid: "input-0", toUuid: "hidden-A", weight: 1 },
        { fromUuid: "input-1", toUuid: "hidden-A", weight: 0.5 },
        { fromUuid: "input-2", toUuid: "hidden-B", weight: 2 },
        { fromUuid: "hidden-A", toUuid: "output-0", weight: 1.5 },
        { fromUuid: "hidden-B", toUuid: "output-0", weight: 1 },
      ],
    },
    derived: {
      impactsByNeuronUuid: {
        "output-0": 1,
        "hidden-A": 0.7,
        "hidden-B": 0.3,
      },
    },
  };
}

function familyNode(): Any {
  const model = buildAggregatedGraphModel(smallSnapshot());
  const flow = buildSankeyFlow(model, {
    labels: { "input-0": "Cash rate", "input-1": "Bond yield" },
    descriptions: { "input-0": "RBA overnight cash rate" },
  });
  const node = flow.nodes.find((n: Any) => n.id === "family:rates");
  assert(node, "the rates family node must exist");
  return node;
}

/** The published panel element, so a rename in the page fails these tests. */
async function publishedPanel(): Promise<Any> {
  const doc = await loadDocument(
    new URL("../docs/sankey/index.html", import.meta.url),
  );
  const panel = doc.getElementById("tooltip");
  assert(panel, "docs/sankey/index.html must declare the #tooltip panel");
  return panel;
}

/** A miniature diagram: one node group, one band, one panel, one bystander. */
function diagramFixture() {
  const doc = parseHtml(`<!DOCTYPE html><html><body>
    <div id="diagram">
      <g class="sankeyNode" tabindex="0"><rect class="sankeyNodeRect"></rect></g>
      <path class="sankeyLink"></path>
    </div>
    <p id="elsewhere">bystander</p>
    <div id="tooltip" class="tooltip" role="tooltip" aria-hidden="true"></div>
  </body></html>`);
  const panel = doc.getElementById("tooltip")!;
  const controller = createTooltipController(panel, {
    getViewport: () => ({ width: 390, height: 844 }),
    measurePanel: () => ({ width: 200, height: 90 }),
  });
  return {
    doc,
    panel,
    controller,
    group: doc.querySelector(".sankeyNode") as unknown as Any,
    band: doc.querySelector(".sankeyLink") as unknown as Any,
    rect: doc.querySelector(".sankeyNodeRect") as unknown as Any,
    elsewhere: doc.getElementById("elsewhere") as unknown as Any,
  };
}

function isVisible(panel: Any): boolean {
  return panel.classList.contains("isVisible") &&
    panel.getAttribute("aria-hidden") === "false";
}

/**
 * Dispatch a bubbling tap on `el`.
 *
 * deno-dom only propagates a dispatched event up the tree when the target
 * itself carries a listener for that type, so a no-op listener is registered
 * first — a harness quirk, not a difference in browser behaviour.
 */
function tap(el: Any): void {
  el.addEventListener("pointerdown", () => {});
  el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
}

function pressKey(target: Any, key: string): void {
  const event = new Event("keydown", { bubbles: true }) as Any;
  event.key = key;
  target.dispatchEvent(event);
}

Deno.test("the panel shows exactly the node's tooltip string", async () => {
  const node = familyNode();
  const panel = await publishedPanel();
  const controller = createTooltipController(panel, {
    getViewport: () => ({ width: 390, height: 844 }),
    measurePanel: () => ({ width: 200, height: 90 }),
  });

  assertEquals(isVisible(panel), false, "the panel starts hidden");
  controller.show(node.tooltip, { x: 40, y: 60 });

  // Equality, not containment: the touch path cannot drift from the <title>
  // path, because both render the same buildNodeTooltip string.
  assertEquals(panel.textContent, node.tooltip);
  assert(node.tooltip.includes("Cash rate — RBA overnight cash rate"));
  assert(isVisible(panel), "the panel must be visible after show()");

  controller.hide();
  assertEquals(isVisible(panel), false);
  assertEquals(panel.getAttribute("aria-hidden"), "true");
});

Deno.test("tapping a node shows the panel; tapping elsewhere dismisses it", () => {
  const f = diagramFixture();
  const node = familyNode();
  attachTooltipTrigger(f.group, node.tooltip, f.controller);
  attachTooltipDismissers(f.doc, f.controller);

  tap(f.group);
  assert(isVisible(f.panel), "tapping the node must show the panel");
  assertEquals(f.panel.textContent, node.tooltip);

  tap(f.elsewhere);
  assertEquals(isVisible(f.panel), false, "tapping away must dismiss");
});

Deno.test("tapping inside the node (its rect child) keeps the panel open", () => {
  const f = diagramFixture();
  attachTooltipTrigger(
    f.group,
    "Cash rate — RBA overnight cash rate",
    f.controller,
  );
  attachTooltipDismissers(f.doc, f.controller);

  tap(f.rect);
  assert(isVisible(f.panel), "a tap on the node's own rect must not dismiss");
});

Deno.test("Escape dismisses the panel", () => {
  const f = diagramFixture();
  attachTooltipTrigger(f.group, "Bond yield — 10-year AGB yield", f.controller);
  attachTooltipDismissers(f.doc, f.controller);

  tap(f.group);
  assert(isVisible(f.panel));

  pressKey(f.doc, "a");
  assert(isVisible(f.panel), "an unrelated key must not dismiss");

  pressKey(f.doc, "Escape");
  assertEquals(isVisible(f.panel), false, "Escape must dismiss");
});

Deno.test("keyboard focus shows the same panel, and blur hides it", () => {
  const f = diagramFixture();
  const node = familyNode();
  attachTooltipTrigger(f.group, node.tooltip, f.controller);

  f.group.dispatchEvent(new Event("focus"));
  assert(isVisible(f.panel), "focusing the node must show the panel");
  assertEquals(f.panel.textContent, node.tooltip);

  f.group.dispatchEvent(new Event("blur"));
  assertEquals(isVisible(f.panel), false, "blur must hide the panel");
});

Deno.test("a band's tooltip text is shown on tap", () => {
  const f = diagramFixture();
  const text = "Cash rate → Score\n42.0% of the Score";
  attachTooltipTrigger(f.band, text, f.controller);

  tap(f.band);
  assertEquals(f.panel.textContent, text);
  assert(isVisible(f.panel));
});

Deno.test("blank tooltip text leaves the panel hidden", () => {
  const f = diagramFixture();
  assertEquals(f.controller.show("   ", { x: 10, y: 10 }), false);
  assertEquals(isVisible(f.panel), false);
});

Deno.test("the panel is clamped inside a phone-width viewport", () => {
  const viewport = { width: 390, height: 844 };
  const panel = { width: 300, height: 140 };

  // Tap near the right/bottom edge: the panel slides back inside.
  const corner = clampTooltipPosition({
    x: 380,
    y: 830,
    panel,
    viewport,
  });
  assertEquals(corner.left, viewport.width - panel.width - TOOLTIP_MARGIN);
  assertEquals(corner.top, viewport.height - panel.height - TOOLTIP_MARGIN);

  // Tap at the very top-left: never closer than the margin.
  const origin = clampTooltipPosition({ x: -50, y: -50, panel, viewport });
  assertEquals(origin.left, TOOLTIP_MARGIN);
  assertEquals(origin.top, TOOLTIP_MARGIN);

  // A panel wider than the viewport pins to the margin rather than overflowing.
  const wide = clampTooltipPosition({
    x: 100,
    y: 100,
    panel: { width: 500, height: 140 },
    viewport,
  });
  assertEquals(wide.left, TOOLTIP_MARGIN);
});

Deno.test("showing the panel writes the clamped position onto the element", () => {
  const f = diagramFixture();
  f.controller.show("Cash rate — RBA overnight cash rate", { x: 380, y: 800 });
  const style = f.panel.getAttribute("style") ?? "";
  // Viewport 390x844, panel 200x90 → clamped to 182 / 746.
  assertEquals(style, "left: 182px; top: 746px;");
});

Deno.test("createTooltipController fails loudly without a panel element", () => {
  let threw = false;
  try {
    createTooltipController(null as unknown as Any);
  } catch {
    threw = true;
  }
  assert(threw, "a missing panel element must throw, not fail silently");
});
