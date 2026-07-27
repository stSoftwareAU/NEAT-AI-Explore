import { assertEquals } from "./test_helpers.ts";

import {
  buildObservationTooltip,
  escapeHtml,
  extractTooltips,
} from "../docs/shared/ui_helpers.js";

// --- escapeHtml ---

Deno.test("escapeHtml escapes ampersand", () => {
  assertEquals(escapeHtml("a & b"), "a &amp; b");
});

Deno.test("escapeHtml escapes angle brackets", () => {
  assertEquals(escapeHtml("<div>"), "&lt;div&gt;");
});

Deno.test("escapeHtml escapes quotes", () => {
  assertEquals(escapeHtml(`"it's"`), "&quot;it&#39;s&quot;");
});

Deno.test("escapeHtml handles all five characters together", () => {
  assertEquals(
    escapeHtml(`<a href="x" title='y'>&`),
    "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;",
  );
});

Deno.test("escapeHtml coerces non-string input to string", () => {
  assertEquals(escapeHtml(42), "42");
  assertEquals(escapeHtml(null), "null");
  assertEquals(escapeHtml(undefined), "undefined");
});

Deno.test("escapeHtml returns empty string for empty input", () => {
  assertEquals(escapeHtml(""), "");
});

// --- extractTooltips ---

Deno.test("extractTooltips returns empty maps for null snapshot", () => {
  const result = extractTooltips(null);
  assertEquals(Object.keys(result.labels).length, 0);
  assertEquals(Object.keys(result.descriptions).length, 0);
  assertEquals(Object.keys(result.groups).length, 0);
});

Deno.test("extractTooltips returns empty maps when no tooltips key", () => {
  const result = extractTooltips({ creature: {} });
  assertEquals(Object.keys(result.labels).length, 0);
});

Deno.test("extractTooltips extracts labels and descriptions", () => {
  const snapshot = {
    tooltips: {
      "input-0": { label: "Price", description: "Current price" },
      "input-1": { label: "Volume", description: "Trade volume" },
    },
  };
  const result = extractTooltips(snapshot);
  assertEquals(result.labels["input-0"], "Price");
  assertEquals(result.labels["input-1"], "Volume");
  assertEquals(result.descriptions["input-0"], "Current price");
  assertEquals(result.descriptions["input-1"], "Trade volume");
});

Deno.test("extractTooltips extracts groups with fallback keys", () => {
  const snapshot = {
    tooltips: {
      "input-0": { label: "A", group: "rates" },
      "input-1": { label: "B", category: "equities" },
      "input-2": { label: "C", domain: "macro" },
    },
  };
  const result = extractTooltips(snapshot);
  assertEquals(result.groups["input-0"], "rates");
  assertEquals(result.groups["input-1"], "equities");
  assertEquals(result.groups["input-2"], "macro");
});

Deno.test("extractTooltips skips entries with empty or whitespace labels", () => {
  const snapshot = {
    tooltips: {
      "input-0": { label: "  ", description: "Valid desc" },
      "input-1": { label: "", description: "Another" },
    },
  };
  const result = extractTooltips(snapshot);
  assertEquals(Object.keys(result.labels).length, 0);
  assertEquals(Object.keys(result.descriptions).length, 2);
});

Deno.test("extractTooltips reads from meta.tooltips as fallback", () => {
  const snapshot = {
    meta: {
      tooltips: {
        "input-0": { label: "Nested", description: "From meta" },
      },
    },
  };
  const result = extractTooltips(snapshot);
  assertEquals(result.labels["input-0"], "Nested");
});

Deno.test("extractTooltips skips invalid entries", () => {
  const snapshot = {
    tooltips: {
      "input-0": null,
      "input-1": "not-an-object",
      "": { label: "Empty UUID" },
      "input-2": { label: "Valid" },
    },
  };
  const result = extractTooltips(snapshot);
  assertEquals(Object.keys(result.labels).length, 1);
  assertEquals(result.labels["input-2"], "Valid");
});

Deno.test("extractTooltips trims label and description values", () => {
  const snapshot = {
    tooltips: {
      "input-0": { label: "  Price  ", description: "  Current  " },
    },
  };
  const result = extractTooltips(snapshot);
  assertEquals(result.labels["input-0"], "Price");
  assertEquals(result.descriptions["input-0"], "Current");
});

// --- buildObservationTooltip (Issue #521) ---

Deno.test("buildObservationTooltip appends the description to the label", () => {
  assertEquals(
    buildObservationTooltip({
      uuid: "input-0",
      label: "divYieldYr-0 (input-0)",
      description: "Dividend yield for the current year",
    }),
    "divYieldYr-0 (input-0) — Dividend yield for the current year",
  );
});

Deno.test("buildObservationTooltip falls back to the label when no description", () => {
  assertEquals(
    buildObservationTooltip({ uuid: "input-0", label: "divYieldYr-0" }),
    "divYieldYr-0",
  );
  assertEquals(
    buildObservationTooltip({
      uuid: "input-0",
      label: "divYieldYr-0",
      description: "   ",
    }),
    "divYieldYr-0",
  );
});

Deno.test("buildObservationTooltip falls back to the uuid when no label", () => {
  assertEquals(buildObservationTooltip({ uuid: "input-7" }), "input-7");
  assertEquals(
    buildObservationTooltip({ uuid: "input-7", description: "Free cash flow" }),
    "input-7 — Free cash flow",
  );
});

Deno.test("buildObservationTooltip returns the description alone when nothing identifies the row", () => {
  assertEquals(
    buildObservationTooltip({ description: "Free cash flow" }),
    "Free cash flow",
  );
});

Deno.test("buildObservationTooltip returns an empty string for empty input", () => {
  assertEquals(buildObservationTooltip(), "");
  assertEquals(buildObservationTooltip({}), "");
});

Deno.test("buildObservationTooltip trims surrounding whitespace", () => {
  assertEquals(
    buildObservationTooltip({ label: "  Price  ", description: "  Now  " }),
    "Price — Now",
  );
});
