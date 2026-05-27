/**
 * Tests for docs/shared/gate_chip.js (Issue #273).
 *
 * The gate chip is a small DOM-free indicator rendered on the neuron card
 * whenever any inbound input is masked by a downstream `min(...)` gate.
 */

import { assert, assertEquals } from "./test_helpers.ts";

import {
  buildGateChipHtml,
  shouldRenderGateChip,
} from "../docs/shared/gate_chip.js";

Deno.test("shouldRenderGateChip: empty / invalid rows render nothing", () => {
  assertEquals(shouldRenderGateChip(null), false);
  assertEquals(shouldRenderGateChip(undefined), false);
  assertEquals(shouldRenderGateChip([]), false);
  assertEquals(shouldRenderGateChip([{}, {}]), false);
});

Deno.test("shouldRenderGateChip: zero gateMaskedFraction does not trigger the chip", () => {
  assertEquals(
    shouldRenderGateChip([
      { gateMaskedFraction: 0 },
      { gateMaskedFraction: 0 },
    ]),
    false,
  );
});

Deno.test("shouldRenderGateChip: any row with gateMaskedFraction > 0 triggers the chip", () => {
  assertEquals(
    shouldRenderGateChip([
      { gateMaskedFraction: 0 },
      { gateMaskedFraction: 0.4 },
    ]),
    true,
  );
});

Deno.test("buildGateChipHtml: empty string when no rows are gated", () => {
  const html = buildGateChipHtml({ rows: [{ gateMaskedFraction: 0 }] });
  assertEquals(html, "");
});

Deno.test("buildGateChipHtml: renders a span when no gateUrl supplied", () => {
  const html = buildGateChipHtml({
    rows: [{ gateMaskedFraction: 0.5 }],
  });
  assert(html.startsWith("<span"), "must render a span when no gateUrl");
  assert(
    html.includes(`data-role="gate-chip"`),
    "must carry the data-role hook for CSS / app.js wiring",
  );
  assert(html.includes(`>Gate<`), "default label is 'Gate'");
});

Deno.test("buildGateChipHtml: renders an anchor with the supplied URL", () => {
  const html = buildGateChipHtml({
    rows: [{ gateMaskedFraction: 0.3 }],
    gateUrl: "#gate-min-1",
  });
  assert(html.startsWith("<a"), "must render an anchor when gateUrl supplied");
  assert(
    html.includes(`href="#gate-min-1"`),
    "anchor must point at the gate definition",
  );
});

Deno.test("buildGateChipHtml: tooltip reports the worst-case masking percentage", () => {
  const html = buildGateChipHtml({
    rows: [
      { gateMaskedFraction: 0.1 },
      { gateMaskedFraction: 0.42 }, // worst
      { gateMaskedFraction: 0.25 },
    ],
  });
  // 0.42 -> "42%"
  assert(
    html.includes("42%"),
    "tooltip must reflect the worst-case masking fraction",
  );
});

Deno.test("buildGateChipHtml: escapes label and URL", () => {
  const html = buildGateChipHtml({
    rows: [{ gateMaskedFraction: 0.5 }],
    label: "<bad>",
    gateUrl: 'javascript:"',
  });
  assert(
    html.includes("&lt;bad&gt;"),
    "label is HTML-escaped",
  );
  // The quote character in the URL must be escaped so it can't break out of
  // the href attribute.
  assert(
    !html.includes('javascript:"'),
    "URL must be HTML-escaped before interpolation",
  );
});

Deno.test("buildGateChipHtml: accepts a custom label", () => {
  const html = buildGateChipHtml({
    rows: [{ gateMaskedFraction: 0.5 }],
    label: "min(...) gate",
  });
  assert(html.includes(">min(...) gate<"), "custom label is rendered");
});
