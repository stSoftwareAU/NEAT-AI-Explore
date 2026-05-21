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
