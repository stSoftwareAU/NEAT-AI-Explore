## Summary

Replaced two HOW-tests in `tests/topology_diagram_test.ts` that pinned the
internal SVG markup of `topologyToSvgString` with WHAT-tests asserting the
diagram's observable contract via the DOM. Closes #375.

The previous assertions broke on markup changes that left the rendered diagram
identical — reordering `<polygon>`/`<line>`, switching `</polygon>` for `/>`, or
expressing the skip arc as a cubic `C`/polyline instead of a quadratic `Q`. The
rewrites parse the SVG with `@b-fuze/deno-dom` (via the existing `parseHtml`
helper) and assert relationships, so refactoring the markup no longer breaks
them while genuine regressions are still caught.

- **Arrow-head/tooltip grouping** (was lines 407-423): instead of a single rigid
  regex demanding `<title>` → `<line>` → `<polygon>` as adjacent self-closing
  siblings, the test now parses the SVG and asserts that every `.topoLink` group
  contains a `<title>` and a `<polygon>` as descendants of the same group — the
  property that makes the arrow's hover surface the link tooltip. Order- and
  syntax-independent.
- **Skip-arc clearance** (was lines 217-262): instead of string-matching the
  `d="M…,… Q…,(cpY)"` path command and asserting `cpY >= 0`, the test selects
  the arc `<path>` via the DOM, extracts every coordinate pair from `d`
  (ignoring the command letters), and asserts every point's `y` stays within the
  viewBox `[0, h]`. By the convex-hull property of Bézier/polyline curves this
  guarantees the rendered arc never leaves the canvas, regardless of whether it
  is drawn as a quadratic `Q`, a cubic `C`, or a polyline.

The other assertions in the viewBox test (largest dot fits, `maxNodeR` matches
the measured radius) are unchanged.

## Evidence

Backend/test-only change — no UI was altered, so no screenshot applies. Verified
by running the suite: the two rewritten tests pass, and the full quality gate
(`deno fmt --check`, `deno lint`, `deno check`, `deno test -A`) is green.

```
deno test -A tests/topology_diagram_test.ts
ok | 16 passed | 0 failed

./quality.sh
ok | 763 passed | 0 failed
==> OK
```

## Test Plan

- Modified
  `tests/topology_diagram_test.ts::topologyToSvgString: arrow-head sits
  inside the link tooltip group`
  — now DOM-based, asserts `<title>` + `<polygon>` share each `.topoLink` group.
- Modified
  `tests/topology_diagram_test.ts::topologyToSvgString: viewBox
  accommodates largest dot and arc clearance`
  — now asserts the skip arc's path points stay within the viewBox vertically,
  instead of matching the `Q` command.
- Added local helpers: `pathCoords` (extracts coordinate pairs from a path `d`)
  and the `parseHtml` import from `tests/dom_helpers.ts`.
- Ran `./quality.sh` — all 763 tests pass.
