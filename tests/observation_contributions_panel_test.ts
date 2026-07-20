/**
 * Tests for docs/shared/observation_contributions.js (Issue #186).
 *
 * The "Observation contributions" panel renders inline on the output neuron
 * card in the Trace Explorer. It must:
 *   - render only for output neurons (hidden / input neurons render nothing);
 *   - show up to 50 rows in descending share order;
 *   - render each row with the observation label and the optional
 *     `tooltips[].group` subtitle.
 *
 * Browser-only behaviour (real DOM, click handlers) cannot be exercised in
 * Deno; the rendering logic is intentionally HTML-string based so it can be
 * tested directly here.
 */

import { assert, assertEquals } from "./test_helpers.ts";

import {
  buildObservationContributionsHtml,
  buildObservationContributionsRow,
  clampTopN,
  DEFAULT_TOP_N,
  formatSharePercent,
  isObservationContributionsOpen,
  MAX_OBSERVATION_ROWS,
  MAX_TOP_N,
  shouldRenderObservationContributions,
} from "../docs/shared/observation_contributions.js";

type Row = {
  uuid: string;
  score: number;
  effectiveShare?: number;
  gateMaskedFraction?: number;
  preGateShare?: number;
};

function makeRows(n: number): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < n; i++) {
    rows.push({ uuid: `input-${i}`, score: (n - i) / n });
  }
  return rows;
}

function countRows(html: string): number {
  const matches = html.match(/observationContributionsRow/g);
  return matches ? matches.length : 0;
}

Deno.test("shouldRenderObservationContributions: only output neurons render", () => {
  assert(shouldRenderObservationContributions("output-0", "output"));
  assert(!shouldRenderObservationContributions("input-3", "input"));
  assert(!shouldRenderObservationContributions("hidden-9", "hidden"));
  assert(!shouldRenderObservationContributions("output-0", undefined));
  assert(!shouldRenderObservationContributions("", "output"));
});

Deno.test("buildObservationContributionsHtml: empty for hidden neurons", () => {
  const html = buildObservationContributionsHtml({
    uuid: "hidden-1",
    neuronType: "hidden",
    inputs: makeRows(5),
  });
  assertEquals(html, "");
});

Deno.test("buildObservationContributionsHtml: empty for input neurons", () => {
  const html = buildObservationContributionsHtml({
    uuid: "input-2",
    neuronType: "input",
    inputs: makeRows(5),
  });
  assertEquals(html, "");
});

Deno.test("buildObservationContributionsHtml: renders for output neurons", () => {
  const html = buildObservationContributionsHtml({
    uuid: "output-0",
    neuronType: "output",
    inputs: makeRows(3),
  });
  assert(html.length > 0, "output neuron should render non-empty HTML");
  assert(
    html.includes("Observation contributions"),
    "heading must read 'Observation contributions'",
  );
  assertEquals(countRows(html), 3);
});

Deno.test("buildObservationContributionsHtml: caps at MAX_OBSERVATION_ROWS when topN allows it", () => {
  // Explicit topN >= MAX_OBSERVATION_ROWS exercises the hard safety ceiling.
  // After #275, topN also caps rendered rows, so we pass topN=MAX_TOP_N to
  // keep the original cap-at-50 intent.
  const html = buildObservationContributionsHtml({
    uuid: "output-0",
    neuronType: "output",
    inputs: makeRows(120),
    topN: MAX_TOP_N,
  });
  assertEquals(countRows(html), MAX_OBSERVATION_ROWS);
  assertEquals(countRows(html), 50);
});

Deno.test("buildObservationContributionsHtml: preserves descending order from input", () => {
  // Caller is responsible for sorting; we verify ordering is preserved.
  const rows: Row[] = [
    { uuid: "input-a", score: 0.5 },
    { uuid: "input-b", score: 0.3 },
    { uuid: "input-c", score: 0.2 },
  ];
  const html = buildObservationContributionsHtml({
    uuid: "output-0",
    neuronType: "output",
    inputs: rows,
  });

  const idxA = html.indexOf("input-a");
  const idxB = html.indexOf("input-b");
  const idxC = html.indexOf("input-c");
  assert(idxA > -1 && idxB > -1 && idxC > -1, "all rows must render");
  assert(idxA < idxB, "highest share renders first");
  assert(idxB < idxC, "ordering preserved across the list");
});

Deno.test("buildObservationContributionsHtml: empty list produces empty string", () => {
  const html = buildObservationContributionsHtml({
    uuid: "output-0",
    neuronType: "output",
    inputs: [],
  });
  assertEquals(html, "");
});

Deno.test("buildObservationContributionsHtml: renders group subtitle when present", () => {
  const rows: Row[] = [
    { uuid: "input-temp", score: 0.6 },
    { uuid: "input-pressure", score: 0.4 },
  ];
  const labels: Record<string, string> = {
    "input-temp": "Temperature",
    "input-pressure": "Pressure",
  };
  const groups: Record<string, string> = {
    "input-temp": "Sensors",
    // input-pressure has no group on purpose.
  };

  const html = buildObservationContributionsHtml({
    uuid: "output-0",
    neuronType: "output",
    inputs: rows,
    getAlias: (uuid) => labels[uuid] ?? null,
    getGroup: (uuid) => groups[uuid] ?? null,
  });

  assert(
    html.includes("Temperature (input-temp)"),
    "row must include the alias and UUID",
  );
  assert(
    html.includes(
      `<div class="observationContributionsGroup">Sensors</div>`,
    ),
    "group subtitle must render when the group is present",
  );
  // The pressure row has no group: no subtitle div should reference 'pressure'.
  const pressureSegment = html.slice(
    html.indexOf("input-pressure"),
    html.indexOf("input-pressure") + 400,
  );
  assert(
    !pressureSegment.includes("observationContributionsGroup"),
    "no subtitle rendered when group is absent",
  );
});

Deno.test("buildObservationContributionsRow: HTML-escapes label and group", () => {
  const html = buildObservationContributionsRow(
    { uuid: "input-x", score: 0.25 },
    {
      getAlias: () => "<script>alert(1)</script>",
      getGroup: () => "Group & Co",
    },
  );
  assert(
    html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"),
    "label must be HTML-escaped",
  );
  assert(html.includes("Group &amp; Co"), "group must be HTML-escaped");
});

// ============================================================================
// Row label uses available width; full label surfaced via `title` (Issue #512).
// ============================================================================

Deno.test("buildObservationContributionsRow: no fixed-width clip on the label div", () => {
  const html = buildObservationContributionsRow(
    { uuid: "input-0", score: 0.5 },
    { getAlias: () => "volume-recommendation" },
  );
  // The label must render in full — no JS-side truncation ellipsis injected.
  assert(
    html.includes("volume-recommendation (input-0)"),
    "full alias (uuid) label must render untruncated",
  );
  assert(
    !html.includes("volume-recommen…"),
    "label must not be hard-truncated with an ellipsis in JS",
  );
});

Deno.test("buildObservationContributionsRow: sets full label as the title attribute", () => {
  const html = buildObservationContributionsRow(
    { uuid: "input-0", score: 0.5 },
    { getAlias: () => "volume-recommendation" },
  );
  assert(
    html.includes('title="volume-recommendation (input-0)"'),
    "row label must carry the full label as a title attribute for hover",
  );
});

Deno.test("buildObservationContributionsRow: escapes the title attribute", () => {
  const html = buildObservationContributionsRow(
    { uuid: "input-x", score: 0.25 },
    { getAlias: () => '"><img>' },
  );
  assert(
    html.includes('title="&quot;&gt;&lt;img&gt; (input-x)"'),
    "title attribute must be HTML-escaped to prevent attribute injection",
  );
});

Deno.test("formatSharePercent: formats a fractional share as a percent string", () => {
  assertEquals(formatSharePercent(0.5, 4), "50.00%");
  assertEquals(formatSharePercent(1, 4), "100.0%");
  assertEquals(formatSharePercent(0, 4), "0.000%");
});

// ============================================================================
// Collapsible <details> wrapper (Issue #187).
// ============================================================================

Deno.test("isObservationContributionsOpen: open on desktop by default", () => {
  assertEquals(isObservationContributionsOpen({ isPhone: false }), true);
  assertEquals(isObservationContributionsOpen({}), true);
});

Deno.test("isObservationContributionsOpen: collapsed on phone by default", () => {
  assertEquals(isObservationContributionsOpen({ isPhone: true }), false);
});

Deno.test("isObservationContributionsOpen: user toggle wins over viewport default", () => {
  // User explicitly opened on phone — stay open across re-renders.
  assertEquals(
    isObservationContributionsOpen({ isPhone: true, userToggle: "open" }),
    true,
  );
  // User explicitly closed on desktop — stay closed across re-renders.
  assertEquals(
    isObservationContributionsOpen({ isPhone: false, userToggle: "closed" }),
    false,
  );
});

Deno.test("buildObservationContributionsHtml: wraps body in <details> with summary", () => {
  const html = buildObservationContributionsHtml({
    uuid: "output-0",
    neuronType: "output",
    inputs: makeRows(3),
  });
  assert(
    html.includes("<details"),
    "panel must use a native <details> element",
  );
  assert(
    html.includes("<summary"),
    "panel must carry the heading in a <summary> element",
  );
  // The summary shows the count so a phone user can scan when collapsed.
  assert(
    html.includes("Observation contributions (top 3)"),
    "summary must show the row count alongside the title",
  );
});

Deno.test("buildObservationContributionsHtml: collapsed by default on phone viewports", () => {
  const html = buildObservationContributionsHtml({
    uuid: "output-0",
    neuronType: "output",
    inputs: makeRows(5),
    isPhone: true,
  });
  // The `open` attribute must NOT appear on the <details> element.
  assert(
    !/<details[^>]*\sopen[\s>]/.test(html),
    "details must be collapsed on phone viewports by default",
  );
});

Deno.test("buildObservationContributionsHtml: open by default on desktop viewports", () => {
  const html = buildObservationContributionsHtml({
    uuid: "output-0",
    neuronType: "output",
    inputs: makeRows(5),
    isPhone: false,
  });
  assert(
    /<details[^>]*\sopen[\s>]/.test(html),
    "details must be open on desktop viewports by default",
  );
});

Deno.test("buildObservationContributionsHtml: user 'open' override persists across re-render on phone", () => {
  // First render on phone: collapsed by default.
  const firstRender = buildObservationContributionsHtml({
    uuid: "output-0",
    neuronType: "output",
    inputs: makeRows(5),
    isPhone: true,
  });
  assert(
    !/<details[^>]*\sopen[\s>]/.test(firstRender),
    "first render on phone is collapsed",
  );

  // Caller (docs/app.js) records the user expanding the panel and passes
  // userToggle: "open" on the next render — the panel must stay open.
  const secondRender = buildObservationContributionsHtml({
    uuid: "output-0",
    neuronType: "output",
    inputs: makeRows(5),
    isPhone: true,
    userToggle: "open",
  });
  assert(
    /<details[^>]*\sopen[\s>]/.test(secondRender),
    "user 'open' toggle must persist across re-render on phone viewports",
  );

  // And a third render with the same override stays open — the toggle is
  // session-scoped, not one-shot.
  const thirdRender = buildObservationContributionsHtml({
    uuid: "output-0",
    neuronType: "output",
    inputs: makeRows(5),
    isPhone: true,
    userToggle: "open",
  });
  assert(
    /<details[^>]*\sopen[\s>]/.test(thirdRender),
    "user 'open' toggle survives repeated re-renders",
  );
});

Deno.test("buildObservationContributionsHtml: user 'closed' override persists across re-render on desktop", () => {
  // Default desktop render is open.
  const firstRender = buildObservationContributionsHtml({
    uuid: "output-0",
    neuronType: "output",
    inputs: makeRows(5),
    isPhone: false,
  });
  assert(
    /<details[^>]*\sopen[\s>]/.test(firstRender),
    "first render on desktop is open",
  );

  // User collapses the panel — subsequent renders must respect that choice.
  const secondRender = buildObservationContributionsHtml({
    uuid: "output-0",
    neuronType: "output",
    inputs: makeRows(5),
    isPhone: false,
    userToggle: "closed",
  });
  assert(
    !/<details[^>]*\sopen[\s>]/.test(secondRender),
    "user 'closed' toggle must persist across re-render on desktop viewports",
  );
});

// ============================================================================
// Top-N ranking, stepper helpers and absolute-impact sort (Issue #243).
// ============================================================================

Deno.test("clampTopN: clamps to [1, MAX_TOP_N]", () => {
  assertEquals(clampTopN(0), 1);
  assertEquals(clampTopN(-5), 1);
  assertEquals(clampTopN(1), 1);
  assertEquals(clampTopN(10), 10);
  assertEquals(clampTopN(MAX_TOP_N), MAX_TOP_N);
  assertEquals(clampTopN(MAX_TOP_N + 1), MAX_TOP_N);
  assertEquals(clampTopN(99999), MAX_TOP_N);
});

Deno.test("clampTopN: floors decimals", () => {
  assertEquals(clampTopN(3.9), 3);
  assertEquals(clampTopN(10.1), 10);
  assertEquals(clampTopN(1.999), 1);
});

Deno.test("clampTopN: rejects NaN, null, undefined, non-numeric strings", () => {
  assertEquals(clampTopN(NaN), DEFAULT_TOP_N);
  assertEquals(clampTopN(null), DEFAULT_TOP_N);
  assertEquals(clampTopN(undefined), DEFAULT_TOP_N);
  assertEquals(clampTopN("abc"), DEFAULT_TOP_N);
  assertEquals(clampTopN({}), DEFAULT_TOP_N);
});

Deno.test("clampTopN: parses numeric strings (stepper input.value)", () => {
  assertEquals(clampTopN("12"), 12);
  assertEquals(clampTopN("0"), 1);
  assertEquals(clampTopN("250"), MAX_TOP_N);
});

Deno.test("DEFAULT_TOP_N and MAX_TOP_N: contract", () => {
  assertEquals(DEFAULT_TOP_N, 10);
  assertEquals(MAX_TOP_N, 100);
});

Deno.test("buildObservationContributionsHtml: sorts by |score| desc when input is unsorted", () => {
  // Caller passes rows in arbitrary order — the panel must sort defensively.
  const rows: Row[] = [
    { uuid: "input-small", score: 0.05 },
    { uuid: "input-large", score: 0.5 },
    { uuid: "input-mid", score: 0.2 },
  ];
  const html = buildObservationContributionsHtml({
    uuid: "output-0",
    neuronType: "output",
    inputs: rows,
  });
  const idxLarge = html.indexOf("input-large");
  const idxMid = html.indexOf("input-mid");
  const idxSmall = html.indexOf("input-small");
  assert(idxLarge < idxMid, "largest |score| renders first");
  assert(idxMid < idxSmall, "second-largest |score| renders next");
});

Deno.test("buildObservationContributionsHtml: sorts by absolute value, not raw value", () => {
  // Negative scores must rank by |score|.
  const rows: Row[] = [
    { uuid: "input-neg-large", score: -0.8 },
    { uuid: "input-pos-small", score: 0.1 },
    { uuid: "input-neg-mid", score: -0.4 },
  ];
  const html = buildObservationContributionsHtml({
    uuid: "output-0",
    neuronType: "output",
    inputs: rows,
  });
  const idxNegLarge = html.indexOf("input-neg-large");
  const idxNegMid = html.indexOf("input-neg-mid");
  const idxPosSmall = html.indexOf("input-pos-small");
  assert(
    idxNegLarge < idxNegMid && idxNegMid < idxPosSmall,
    "rows must be ranked by |score| descending regardless of sign",
  );
});

Deno.test("buildObservationContributionsHtml: default topN is 10", () => {
  const rows = makeRows(20);
  const html = buildObservationContributionsHtml({
    uuid: "output-0",
    neuronType: "output",
    inputs: rows,
  });
  // Count rows marked as top-influencer — default should be 10.
  const marked = html.match(/data-top-influencer="true"/g) ?? [];
  assertEquals(marked.length, 10);
});

Deno.test("buildObservationContributionsHtml: topN=3 renders and marks exactly 3 rows", () => {
  const rows = makeRows(10);
  const html = buildObservationContributionsHtml({
    uuid: "output-0",
    neuronType: "output",
    inputs: rows,
    topN: 3,
  });
  // After #275, topN caps rendered rows — only 3 rows render and all 3
  // carry the top-influencer marker.
  assertEquals(countRows(html), 3);
  const marked = html.match(/data-top-influencer="true"/g) ?? [];
  assertEquals(marked.length, 3);
});

Deno.test("buildObservationContributionsHtml: topN greater than rendered rows marks all rendered rows", () => {
  const rows = makeRows(5);
  const html = buildObservationContributionsHtml({
    uuid: "output-0",
    neuronType: "output",
    inputs: rows,
    topN: 50,
  });
  const marked = html.match(/data-top-influencer="true"/g) ?? [];
  assertEquals(marked.length, 5);
});

Deno.test("buildObservationContributionsHtml: invalid topN falls back to default", () => {
  const rows = makeRows(20);
  const html = buildObservationContributionsHtml({
    uuid: "output-0",
    neuronType: "output",
    inputs: rows,
    topN: NaN,
  });
  const marked = html.match(/data-top-influencer="true"/g) ?? [];
  assertEquals(marked.length, DEFAULT_TOP_N);
});

Deno.test("buildObservationContributionsHtml: topN clamped to MAX_TOP_N", () => {
  const rows = makeRows(MAX_OBSERVATION_ROWS);
  const html = buildObservationContributionsHtml({
    uuid: "output-0",
    neuronType: "output",
    inputs: rows,
    topN: 9999,
  });
  const marked = html.match(/data-top-influencer="true"/g) ?? [];
  // MAX_TOP_N is 100; only MAX_OBSERVATION_ROWS (50) rows render, so all are
  // marked.
  assertEquals(marked.length, MAX_OBSERVATION_ROWS);
});

Deno.test("buildObservationContributionsHtml: renders a numeric stepper carrying the current topN", () => {
  const rows = makeRows(20);
  const html = buildObservationContributionsHtml({
    uuid: "output-0",
    neuronType: "output",
    inputs: rows,
    topN: 7,
  });
  // The stepper is rendered with min=1, max=100, step=1 and the current value.
  assert(
    html.includes(`data-role="observation-topn-stepper"`),
    "stepper must carry a data-role hook for the app.js wiring",
  );
  assert(
    /min="1"[^>]*max="100"[^>]*step="1"/.test(html) ||
      /min="1"[^>]*step="1"[^>]*max="100"/.test(html),
    "stepper must constrain min=1, max=100, step=1",
  );
  assert(
    html.includes(`value="7"`),
    "stepper value must reflect the current topN",
  );
  assert(
    html.includes(`type="number"`),
    "stepper must use a native number input for accessibility / mobile keypads",
  );
});

Deno.test("buildObservationContributionsHtml: stepper falls back to default when topN invalid", () => {
  const html = buildObservationContributionsHtml({
    uuid: "output-0",
    neuronType: "output",
    inputs: makeRows(20),
    topN: "not-a-number" as unknown as number,
  });
  assert(
    html.includes(`value="${DEFAULT_TOP_N}"`),
    "invalid topN renders the stepper with the default value",
  );
});

Deno.test("buildObservationContributionsHtml: summary reflects topN label", () => {
  const rows = makeRows(20);
  const html = buildObservationContributionsHtml({
    uuid: "output-0",
    neuronType: "output",
    inputs: rows,
    topN: 5,
  });
  assert(
    html.includes("Observation contributions (top 5)"),
    "summary must reflect the currently chosen topN",
  );
});

// ============================================================================
// Issue #275 — topN caps the number of rendered rows (not just highlights).
// ============================================================================

Deno.test("buildObservationContributionsHtml (#275): topN=5 with 20 inputs renders exactly 5 rows", () => {
  const html = buildObservationContributionsHtml({
    uuid: "output-0",
    neuronType: "output",
    inputs: makeRows(20),
    topN: 5,
  });
  assertEquals(countRows(html), 5);
});

Deno.test("buildObservationContributionsHtml (#275): topN=10 with 3 inputs renders all 3 rows", () => {
  const html = buildObservationContributionsHtml({
    uuid: "output-0",
    neuronType: "output",
    inputs: makeRows(3),
    topN: 10,
  });
  assertEquals(countRows(html), 3);
});

Deno.test("buildObservationContributionsHtml (#275): default topN renders DEFAULT_TOP_N rows when more inputs are available", () => {
  const html = buildObservationContributionsHtml({
    uuid: "output-0",
    neuronType: "output",
    inputs: makeRows(20),
  });
  assertEquals(countRows(html), DEFAULT_TOP_N);
});

Deno.test("buildObservationContributionsHtml: data-uuid is set on the <details> element", () => {
  // docs/app.js looks up the details element by data-uuid to attach the
  // toggle listener — guard the attribute so that lookup doesn't silently
  // regress.
  const html = buildObservationContributionsHtml({
    uuid: "output-7",
    neuronType: "output",
    inputs: makeRows(2),
  });
  assert(
    html.includes(`data-uuid="output-7"`),
    "<details> must carry data-uuid for the toggle wiring in docs/app.js",
  );
});

// ============================================================================
// Issue #273 — gate-aware display (effectiveShare + pre-gate badge).
// ============================================================================

Deno.test("buildObservationContributionsHtml (#273): renders effectiveShare as the primary percent", () => {
  // When effectiveShare is supplied it must drive the primary number, not
  // the raw `score` field. The caller may pass `score` equal to the pre-gate
  // value and `effectiveShare` equal to the post-gate value.
  const rows: Row[] = [
    {
      uuid: "input-gated",
      score: 0.8,
      effectiveShare: 0.2,
      gateMaskedFraction: 0.75,
    },
  ];
  const html = buildObservationContributionsHtml({
    uuid: "output-0",
    neuronType: "output",
    inputs: rows,
  });
  // Effective share is 20% — the primary stat must reflect it.
  assert(
    html.includes("20.00%"),
    "primary stat must render effectiveShare (20%) when supplied",
  );
});

Deno.test("buildObservationContributionsHtml (#273): pre-gate badge only renders when gateMaskedFraction > 0", () => {
  // Ungated row: no pre-gate badge.
  const ungatedHtml = buildObservationContributionsHtml({
    uuid: "output-0",
    neuronType: "output",
    inputs: [{ uuid: "input-a", score: 0.5 }],
  });
  assert(
    !ungatedHtml.includes("preGateBadge"),
    "ungated row must not render the pre-gate badge",
  );
  assert(
    !ungatedHtml.includes("pre-gate:"),
    "ungated row must not render the pre-gate label",
  );

  // Gated row: badge renders with tooltip.
  const gatedHtml = buildObservationContributionsHtml({
    uuid: "output-0",
    neuronType: "output",
    inputs: [{
      uuid: "input-b",
      score: 0.5,
      effectiveShare: 0.1,
      gateMaskedFraction: 0.8,
      preGateShare: 0.5,
    }],
  });
  assert(
    gatedHtml.includes("preGateBadge"),
    "gated row must render the pre-gate badge",
  );
  assert(
    gatedHtml.includes("pre-gate:"),
    "gated row must label the badge as pre-gate",
  );
  assert(
    gatedHtml.includes("Pre-gate share"),
    "badge tooltip must explain the pre-gate semantics",
  );
  assert(
    /masked by downstream min\(\.\.\.\) gate in [^"]+% of samples/.test(
      gatedHtml,
    ),
    "tooltip must report the masked sample fraction",
  );
});

Deno.test("buildObservationContributionsHtml (#273): zero gateMaskedFraction does not render the badge", () => {
  const html = buildObservationContributionsHtml({
    uuid: "output-0",
    neuronType: "output",
    inputs: [{
      uuid: "input-c",
      score: 0.4,
      effectiveShare: 0.4,
      gateMaskedFraction: 0,
    }],
  });
  assert(
    !html.includes("preGateBadge"),
    "gateMaskedFraction === 0 must suppress the badge",
  );
});

Deno.test("buildObservationContributionsHtml (#273): existing layout/order is preserved with gated rows", () => {
  // Layout invariants from #243 / #186 must still hold once gating is on.
  const rows: Row[] = [
    {
      uuid: "input-large",
      score: 0.5,
      effectiveShare: 0.5,
      gateMaskedFraction: 0,
    },
    {
      uuid: "input-mid",
      score: 0.3,
      effectiveShare: 0.1,
      gateMaskedFraction: 0.66,
    },
    {
      uuid: "input-small",
      score: 0.05,
      effectiveShare: 0.05,
      gateMaskedFraction: 0,
    },
  ];
  const html = buildObservationContributionsHtml({
    uuid: "output-0",
    neuronType: "output",
    inputs: rows,
    topN: 5,
  });
  // Sort is by |score| desc — large then mid then small.
  const idxLarge = html.indexOf("input-large");
  const idxMid = html.indexOf("input-mid");
  const idxSmall = html.indexOf("input-small");
  assert(idxLarge < idxMid && idxMid < idxSmall, "descending sort preserved");
  // Still wrapped in <details>/<summary> and carries data-uuid.
  assert(html.includes("<details"), "still rendered inside <details>");
  assert(html.includes('data-uuid="output-0"'), "data-uuid still present");
  // All three rows render even though one is gated.
  const rowMatches = html.match(/observationContributionsRow/g) ?? [];
  assertEquals(rowMatches.length, 3);
});

Deno.test("buildObservationContributionsHtml (#273): note text mentions the pre-gate badge", () => {
  const html = buildObservationContributionsHtml({
    uuid: "output-0",
    neuronType: "output",
    inputs: makeRows(3),
  });
  assert(
    html.includes("pre-gate"),
    "panel note must explain the pre-gate badge to the user",
  );
});
