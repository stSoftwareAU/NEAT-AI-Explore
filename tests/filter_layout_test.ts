/**
 * Tests for docs/shared/filter_layout.js (Issue #245).
 *
 * The pure decision functions choose between rendering the inbound
 * filter controls inline with the panel heading or collapsing them
 * behind a "Filters" popover. The decision must be driven by the
 * measured fit (so it copes with arbitrary panel widths in narrow
 * tablet splits or zoomed-in viewports), with a viewport-width
 * fallback for environments that lack `ResizeObserver`.
 */

import { assert, assertEquals } from "./test_helpers.ts";
import {
  decideFiltersMode,
  decideFiltersModeByWidth,
} from "../docs/shared/filter_layout.js";

// ---------------------------------------------------------------------------
// decideFiltersMode — driven by measured controls vs panel width.
// ---------------------------------------------------------------------------

Deno.test("decideFiltersMode is inline when controls fit", () => {
  assertEquals(decideFiltersMode(800, 400), "inline");
});

Deno.test("decideFiltersMode is collapsed when controls overflow", () => {
  assertEquals(decideFiltersMode(400, 800), "collapsed");
});

Deno.test("decideFiltersMode is inline at the exact boundary", () => {
  // Controls that exactly fill the panel still count as fitting —
  // collapsing would needlessly hide them.
  assertEquals(decideFiltersMode(600, 600), "inline");
});

Deno.test("decideFiltersMode is collapsed one px past the boundary", () => {
  assertEquals(decideFiltersMode(600, 601), "collapsed");
});

Deno.test("decideFiltersMode falls back to inline on non-finite inputs", () => {
  assertEquals(decideFiltersMode(NaN, 400), "inline");
  assertEquals(decideFiltersMode(800, Infinity), "inline");
  // @ts-expect-error intentionally passing the wrong type
  assertEquals(decideFiltersMode("800", 400), "inline");
  // @ts-expect-error intentionally passing the wrong type
  assertEquals(decideFiltersMode(800, undefined), "inline");
});

Deno.test("decideFiltersMode falls back to inline for zero or negative widths", () => {
  // ResizeObserver fires a 0×0 entry while the panel is hidden — keep
  // the safer inline mode rather than flashing the popover button.
  assertEquals(decideFiltersMode(0, 400), "inline");
  assertEquals(decideFiltersMode(800, 0), "inline");
  assertEquals(decideFiltersMode(-1, 400), "inline");
});

// ---------------------------------------------------------------------------
// decideFiltersModeByWidth — fallback heuristic.
// ---------------------------------------------------------------------------

Deno.test("decideFiltersModeByWidth collapses below MOBILE_MAX (640)", () => {
  assertEquals(decideFiltersModeByWidth(320), "collapsed");
  assertEquals(decideFiltersModeByWidth(375), "collapsed");
  assertEquals(decideFiltersModeByWidth(639), "collapsed");
});

Deno.test("decideFiltersModeByWidth stays inline at and above MOBILE_MAX", () => {
  assertEquals(decideFiltersModeByWidth(640), "inline");
  assertEquals(decideFiltersModeByWidth(768), "inline");
  assertEquals(decideFiltersModeByWidth(1440), "inline");
});

Deno.test("decideFiltersModeByWidth falls back to inline on non-finite", () => {
  assertEquals(decideFiltersModeByWidth(NaN), "inline");
  assertEquals(decideFiltersModeByWidth(Infinity), "inline");
  // @ts-expect-error wrong type
  assertEquals(decideFiltersModeByWidth("640"), "inline");
});

// ---------------------------------------------------------------------------
// Returned values are always one of the documented literals.
// ---------------------------------------------------------------------------

Deno.test("decideFiltersMode only returns 'inline' or 'collapsed'", () => {
  const samples: Array<[number, number]> = [
    [800, 400],
    [400, 800],
    [0, 0],
    [-10, -10],
    [NaN, NaN],
  ];
  for (const [p, c] of samples) {
    const result = decideFiltersMode(p, c);
    assert(
      result === "inline" || result === "collapsed",
      `Unexpected mode ${result} for (${p}, ${c})`,
    );
  }
});
