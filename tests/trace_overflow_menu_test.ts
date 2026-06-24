/**
 * Regression test for Issue #383 — tapping the trace-nav "⋯" (More actions)
 * did nothing on mobile, so the popover never revealed Observations / 🧠 /
 * Synapses.
 *
 * Root cause: `initTraceOverflowMenu()` ran twice (once standalone, once via
 * `initCompactTraceNav()`), binding two click listeners to the "⋯" button.
 * Each tap fired both listeners and each toggled the open state, so they
 * cancelled out — net result: the popover stayed closed.
 *
 * The wiring now lives in `wireTraceOverflowMenu()` and is idempotent: a
 * repeat call on the same wrapper is a no-op, so a single tap reliably opens
 * the popover no matter how many times the initialiser runs. These tests
 * build a real (parsed) DOM, dispatch genuine click events, and assert on
 * the observable open/closed state.
 */

import { assert, assertEquals } from "./test_helpers.ts";
import { parseHtml } from "./dom_helpers.ts";
import type { Element } from "@b-fuze/deno-dom";
import { wireTraceOverflowMenu } from "../docs/shared/trace_overflow_menu.js";

/** Markup mirroring the collapsed `.traceOverflow` block in docs/index.html. */
const OVERFLOW_MARKUP = `
<div class="traceOverflow" data-overflow-mode="collapsed" data-overflow-open="false">
  <button class="traceOverflowSummary" aria-label="More actions"
    aria-haspopup="true" aria-expanded="false">⋯</button>
  <div class="traceOverflowMenu" role="menu">
    <button id="obsBtn" role="menuitem">Observations</button>
    <a id="graphBtn" href="./graph/" role="menuitem">🧠</a>
    <button id="synapsePanelToggle" role="menuitem">Synapses ⇄</button>
  </div>
</div>`;

function buildWrapper() {
  const doc = parseHtml(OVERFLOW_MARKUP);
  const wrapper = doc.querySelector(".traceOverflow");
  assert(wrapper, "fixture must contain a .traceOverflow wrapper");
  return { doc, wrapper: wrapper! };
}

function clickSummary(wrapper: Element) {
  const summary = wrapper.querySelector(".traceOverflowSummary")!;
  summary.dispatchEvent(new Event("click"));
}

Deno.test("a single tap opens the overflow popover (Issue #383)", () => {
  const { doc, wrapper } = buildWrapper();
  wireTraceOverflowMenu(wrapper, doc);

  clickSummary(wrapper);

  assertEquals(
    wrapper.getAttribute("data-overflow-open"),
    "true",
    "one tap must reveal the popover",
  );
  assertEquals(
    wrapper.querySelector(".traceOverflowSummary")!.getAttribute(
      "aria-expanded",
    ),
    "true",
  );
});

Deno.test("a second tap closes the overflow popover (Issue #383)", () => {
  const { doc, wrapper } = buildWrapper();
  wireTraceOverflowMenu(wrapper, doc);

  clickSummary(wrapper); // open
  clickSummary(wrapper); // close

  assertEquals(
    wrapper.getAttribute("data-overflow-open"),
    "false",
    "tapping again must hide the popover",
  );
});

Deno.test("wiring is idempotent — double init still opens on first tap (Issue #383)", () => {
  const { doc, wrapper } = buildWrapper();
  // Simulate the historical double-call (standalone + via initCompactTraceNav).
  const first = wireTraceOverflowMenu(wrapper, doc);
  const second = wireTraceOverflowMenu(wrapper, doc);

  assertEquals(first, true, "first wiring should attach handlers");
  assertEquals(second, false, "second wiring must be a no-op");

  clickSummary(wrapper);

  assertEquals(
    wrapper.getAttribute("data-overflow-open"),
    "true",
    "with double wiring the popover must still open on a single tap",
  );
});

Deno.test("selecting a menu item closes the popover (Issue #383)", () => {
  const { doc, wrapper } = buildWrapper();
  wireTraceOverflowMenu(wrapper, doc);

  clickSummary(wrapper); // open
  assertEquals(wrapper.getAttribute("data-overflow-open"), "true");

  wrapper.querySelector("#obsBtn")!.dispatchEvent(new Event("click"));

  assertEquals(
    wrapper.getAttribute("data-overflow-open"),
    "false",
    "choosing an action must dismiss the popover",
  );
});

Deno.test("missing wrapper or summary is handled gracefully (Issue #383)", () => {
  assertEquals(wireTraceOverflowMenu(null), false);
  const doc = parseHtml(`<div class="traceOverflow"></div>`);
  // No .traceOverflowSummary inside — nothing to wire.
  assertEquals(
    wireTraceOverflowMenu(doc.querySelector(".traceOverflow"), doc),
    false,
  );
});
