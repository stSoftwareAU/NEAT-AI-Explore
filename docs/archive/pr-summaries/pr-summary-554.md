# Remove the compare page's side-by-side iframe mode (Issue #554)

## Summary

The `/compare/` page (Issue #528) shipped a "Compare side by side" mode that
embedded all three candidate views (layered DAG, Sankey, top-impact subgraph) as
`<iframe>`s, each loading the full snapshot at once. This was too heavy — on
phones the page could render blank/frozen. The candidate evaluation is complete
and the winner is recorded in `docs/archive/candidate-view-evaluation-528.md`, so
the side-by-side comparison has served its purpose.

This change removes the side-by-side mode on all devices while keeping the
compare page and its launcher cards to the three candidate views. Specifically:

- Removed the "Compare side by side" button, the `#sideBySide` iframe section,
  and the `.sideBySideControls` row from `docs/compare/index.html`.
- Removed `renderSideBySide()` / `toggleSideBySide()` and their wiring from
  `docs/compare/compare.js`; `apply()` now only re-renders the launcher cards.
- Removed the dead `.sideBySide*`, `.frameCard`, `.frameTitle`, and iframe CSS
  from `docs/compare/compare.css`.
- Updated the CSP rationale comment — the page now only links out to the
  candidate views (no same-origin iframes).

The service-worker precache (`docs/sw.js`) needed no change: the compare page's
own assets (`index.html`, `compare.js`, `compare.css`, `boot.js`) all stay, and
the side-by-side mode had no separate asset files, so no dead files were being
precached.

The three candidate pages (`/dag/`, `/sankey/`, `/subgraph/`) and the #528
evaluation archive are untouched.

Closes #554.

## Evidence

Compare page on a phone viewport (390×844) after the change — only the launcher
cards remain, no "Compare side by side" control:

![Compare page on phone showing only launcher cards](docs/evidence/issue-554-compare-phone.png)

Desktop viewport (1280×900):

![Compare page on desktop showing only launcher cards](docs/evidence/issue-554-compare-desktop.png)

```mermaid
flowchart LR
    A[/compare/ page] --> B[Launcher cards]
    B --> C[Open Layered DAG]
    B --> D[Open Sankey]
    B --> E[Open Top-impact subgraph]
    X[Compare side by side iframe mode]:::removed -.removed.-> A
    classDef removed stroke-dasharray:5 5,color:#888;
```

## Test Plan

- Added `tests/compare_side_by_side_removed_test.ts` — parses the published
  `docs/compare/index.html` into a DOM (via `@b-fuze/deno-dom`, the Issue #312
  semantic-query pattern) and asserts the removal contract:
  - the `#cards` launcher container is kept;
  - `#sideBySideBtn`, `#sideBySide`, and `.sideBySideControls` are gone;
  - the page embeds no `<iframe>`;
  - `compare.css` no longer defines `.sideBySide`, `.frameCard`, `.frameTitle`.
  These tests fail against the unfixed page and pass after the change.
- `tests/candidate_comparison_test.ts` (the launcher-card / shared-module
  contract) is unchanged and still passes.
- `./quality.sh` passes cleanly (fmt, lint, type check, 1120+ tests).
