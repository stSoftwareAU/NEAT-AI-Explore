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
  formatSharePercent,
  isObservationContributionsOpen,
  MAX_OBSERVATION_ROWS,
  shouldRenderObservationContributions,
} from "../docs/shared/observation_contributions.js";

type Row = { uuid: string; score: number };

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

Deno.test("buildObservationContributionsHtml: caps at 50 rows", () => {
  const html = buildObservationContributionsHtml({
    uuid: "output-0",
    neuronType: "output",
    inputs: makeRows(120),
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
