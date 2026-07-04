## Summary

The Starfield page (`docs/starfield/index.html`) declared the same document
`<title>` as the separate Graph page — `NEAT-AI Explore - Graph view` — making
the two pages indistinguishable in browser tabs, history, bookmarks, and to
screen readers on page load. Changed the Starfield page's title to
`NEAT-AI Explore - Starfield view` so each app-shell page is uniquely
identifiable (HTML best-practices bucket check #7). Closes #424.

## Evidence

The `<title>` appears in browser chrome (the tab/history/bookmark label), not in
the rendered page body, so a page screenshot cannot capture it and Playwright
MCP was unavailable in this run. Verification is instead pinned by unit tests
that read the published HTML and assert each app-shell page declares a distinct,
descriptive title:

```
index.html declares the expected <title> ... ok
graph/index.html declares the expected <title> ... ok
starfield/index.html declares the expected <title> ... ok
app-shell pages have distinct titles ... ok
```

Change at a glance:

```diff
-    <title>NEAT-AI Explore - Graph view</title>
+    <title>NEAT-AI Explore - Starfield view</title>
```

## Test Plan

- Added `tests/page_title_test.ts`:
  - Asserts each of the three app-shell pages (`docs/index.html`,
    `docs/graph/index.html`, `docs/starfield/index.html`) declares its expected
    `<title>` — this is the regression test that fails against the unfixed
    Starfield page.
  - Asserts all three titles are distinct so no future page can silently reuse
    another's title.
- Full quality gate (`./quality.sh`) passes: `758 passed | 0 failed`.
