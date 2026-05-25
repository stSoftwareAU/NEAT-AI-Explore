# Changelog

All notable changes to **NEAT-AI Explore** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The source of truth for the current version string is
[`version.json`](version.json). The `.github/workflows/semver-bump.yml` action
auto-increments the patch component on PRs that don't change `version.json`
themselves; minor and major bumps are made manually when warranted.

> **🇦🇺 Spelling:** Australian English (`colour`, `behaviour`, ...) throughout.

---

## [Unreleased]

### Added

- `CONTRIBUTING.md` documenting the dev environment setup, the `Develop` branch
  workflow, the `./quality.sh` quality gate (fmt + lint + type check + tests),
  and the `docs/pr-summary-NNN.md` PR convention.
- `CHANGELOG.md` (this file) following the Keep a Changelog format, with an
  initial entry for `0.1.0`.

---

## [0.1.16] - 2026-05-26

### Added

- Network-topology diagram is now click-to-pop-out: clicking the diagram
  background opens a landscape (16∶9) modal that re-renders the topology at a
  larger size, with focus trap, scroll lock, and focus restoration on close
  (Issue #241).
- New `docs/shared/topo_modal.js` controller (`createTopoModalController`) wires
  open/close/Escape/backdrop with the existing `modal_focus.js` helpers.
- `docs/index.html` gains the `.topoModalBackdrop` / `#topoModal` scaffold;
  `docs/styles.css` adds landscape sizing and `cursor: zoom-in` hint.

---

## [0.1.15] - 2026-05-26

### Added

- Inbound-synapses filter controls (Min alloc imp, Top K) are now displayed
  inline on the same header row as the heading, count badge, and Sort select on
  roomy viewports (≥640 px), replacing the previous `<details>` disclosure
  widget (Issue #245).
- A `ResizeObserver`-driven `syncFiltersModeFromMeasurement` helper in
  `docs/shared/filter_layout.js` switches the panel between
  `data-filters-mode="inline"` and `data-filters-mode="collapsed"` based on
  actual measured fit rather than a hard-coded breakpoint; falls back to the 639
  px `MOBILE_MAX` heuristic when `ResizeObserver` is unavailable.
- A "Filters" popover button (`#synapseFiltersToggle`) appears in collapsed mode
  and opens a focus-trapped popover with `aria-expanded` state, keyboard
  (Escape) and click-outside dismiss, and focus return to the trigger on close.

### Changed

- `#synapseFilterPanel` is reused in both inline and collapsed modes; input IDs
  (`#synapseMinAlloc`, `#synapseTopK`) are unchanged so existing wiring in
  `docs/app.js` continues to drive the inbound list without modification.

---

## [0.1.14] - 2026-05-26

### Added

- Inline legend below the topology diagram explaining dot size (log-scaled
  neuron count), link thickness (log-scaled synapse count), and link colour
  (diverging weight-sum red↔blue) with matching mini-swatches (Issue #240).
- Richer hover tooltips: layer dots surface the layer index and pluralised
  neuron count; inter-layer links surface the synapse count and `Σw` (two
  decimal places, sign preserved).
- Arrow-head polygon now shares the link's `<g class="topoLink">` tooltip group
  so hovering the arrow shows the same tooltip text as the link body.
- `topologyLegendHtml`, `formatDotTooltip`, `formatLinkTooltip`, and `pluralise`
  pure helpers in `docs/shared/topology_diagram.js` — DOM-free and reusable by
  the forthcoming pop-out modal (Issue #241).

---

## [0.1.13] - 2026-05-25

### Added

- Topology diagram dot radii now scale logarithmically with neuron count per
  layer; link thicknesses scale logarithmically with synapse count (Issue #239).
- Link colour, arrow heads, and skip arcs use `divergingWeightSumColourCss` —
  red for negative weight sums, neutral near zero, blue for positive.
- `topologyToSvgString` pure helper in `docs/shared/topology_diagram.js` —
  DOM-free and fully unit-testable; `renderTopologyDiagram` is now a thin
  DOM/event wrapper around it.
- SVG layout (`cy`, `svgH`, `padX`, `nodeSpacing`, label position, arc
  clearance) recomputed against the variable max radius so the largest dot is
  never clipped.
- `tests/topology_diagram_test.ts` — unit tests covering `topologyToSvgString`.

---

## [0.1.12] - 2026-05-25

### Added

- Observation contributions panel now ranks rows by `|score|` descending so the
  highest-impact inputs always appear first, regardless of caller-supplied order
  (Issue #243).
- `clampTopN(value)` pure helper — floors decimals, clamps to `[1, MAX_TOP_N]`,
  falls back to `DEFAULT_TOP_N` (10) for `NaN`/non-numeric input.
- `docs/shared/observation_contributions_storage.js` wraps `localStorage`
  get/set with try/catch so private-mode or quota-exceeded failures cannot break
  the panel.
- Top-N stepper (range 1–100, default 10) added to the Observation Contributions
  panel header; choice persists across reloads via `localStorage` under the key
  `obs-contrib.topN`.
- CSS accent-coloured left-border + tint for
  `.observationContributionsRow.top-influencer` rows, with a phone-viewport rule
  that wraps the stepper onto its own line.
- `docs/sw.js` updated to cache `observation_contributions_storage.js` so the
  panel stays functional offline.
- `tests/observation_contributions_test.ts` — unit tests covering `clampTopN`
  and `buildObservationContributionsHtml` sort order.

---

## [0.1.11] - 2026-05-25

### Added

- `weightSum` aggregate added to every `TopologyEdge` returned by
  `computeLayerTopology`, computed alongside the existing `count` (Issue #238).
- `docs/shared/scale.js` exporting
  `logScalePixels(value, maxValue, minPx, maxPx)` for log-compressed pixel
  sizing of topology edges.
- `divergingWeightSumColourCss(weightSum, maxAbsWeightSum)` export in
  `docs/shared/colour_maps.js` — a symmetric red ↔ grey ↔ blue palette with WCAG
  AA contrast on both light and dark theme backgrounds.

---

## [0.1.10] - 2026-05-25

### Added

- `docs/shared/number_format.js` shared module exporting `formatInteger`,
  `formatDecimal`, `formatLarge`, and `formatSigned` helpers, all using the
  `en-AU` locale for digit grouping and returning `"—"` for missing or
  non-finite inputs (Issue #242).
- Routed ad-hoc `toFixed` / `toLocaleString` call sites in `docs/app.js`,
  `docs/shared/trace_score.js`, and `docs/graph/graph.js` through the new
  helpers, homogenising numeric output across all browser locales.
- `tests/number_format_test.ts` — 19 unit tests covering the happy path, edge
  cases (0, negative, NaN, null, undefined, Infinity, large values), and locale
  grouping for each of the four helpers.

---

## [0.1.9] - 2026-05-25

### Added

- Content-Security-Policy `<meta>` tag added to each PWA entry HTML
  (`docs/index.html`, `docs/graph/index.html`, `docs/starfield/index.html`) with
  a strict `script-src 'self'` policy and `connect-src` mirroring the existing
  `ALLOWED_SNAPSHOT_ORIGINS` allowlist (Issue #218).
- Inline `<script type="module">` boot blocks extracted to dedicated
  `docs/boot.js`, `docs/graph/boot.js`, and `docs/starfield/boot.js` files so
  the CSP can enforce `script-src 'self'` without `'unsafe-inline'`.
- `X-Content-Type-Options: nosniff` and
  `Referrer-Policy: strict-origin-when-cross-origin` meta tags added to all
  three entry HTML files.

---

## [0.1.8] - 2026-05-25

### Changed

- Refreshed `deno.lock` via `deno cache --reload` after the Python Playwright
  port-out landed — removes four orphan `npm:playwright*` specifiers and bumps
  `jsr:@std/*` packages to their latest patch versions (Issue #228).

### Added

- `tests/deno_lock_playwright_test.ts`: regression tests that pin the
  single-language stack — asserts no orphan playwright specifiers in
  `deno.lock`, no Python files under `scripts/`, no Python project metadata at
  the repo root, and no Python Playwright install instructions in docs.

---

## [0.1.7] - 2026-05-25

### Changed

- Ported `scripts/generate_pwa_assets.py` to Deno TypeScript
  (`scripts/generate_pwa_assets.ts`) — removes the Python/Pillow dependency and
  aligns the icon-generation pipeline with the project's Deno-first toolchain
  (Issue #227). Uses jimp for pure-JS raster output (avoids `node_modules/`),
  generates `docs/icons/icon-source.png`, all 11 sized PNGs, and a
  multi-resolution `docs/favicon.ico` (16/32/48 px).

### Added

- `tests/generate_pwa_assets_check_test.ts`: regression tests covering
  `deno check`, bare specifiers, deterministic seed, all 11 icon sizes, every
  output filename, and removal of the Python script.

### Removed

- Deleted `scripts/generate_pwa_assets.py` — superseded by the Deno port above.

---

## [0.1.6] - 2026-05-24

### Changed

- Ported `scripts/capture_transition_evidence.py` to Deno TypeScript
  (`scripts/capture_transition_evidence.ts`) — removes the Python dependency and
  aligns the script with the project's Deno-first toolchain (Issue #226).

### Added

- `tests/capture_transition_evidence_check_test.ts`: unit tests for the ported
  transition-evidence capture script.

### Removed

- Deleted `scripts/capture_transition_evidence.py` — superseded by the Deno port
  above.

---

## [0.1.5] - 2026-05-24

### Changed

- Ported `scripts/verify_theme_layout.py` to Deno TypeScript
  (`scripts/verify_theme_layout.ts`) — removes the Python dependency and aligns
  the script with the project's Deno-first toolchain (Issue #225).

### Added

- `tests/verify_theme_layout_check_test.ts`: unit tests for the ported
  theme-layout verification logic.

### Removed

- Deleted `scripts/verify_theme_layout.py` — superseded by the Deno port above.

---

## [0.1.4] - 2026-05-24

### Changed

- Ported `scripts/verify_starfield_layout.py` to Deno TypeScript
  (`scripts/verify_starfield_layout.ts`) — removes the Python dependency and
  aligns the script with the project's Deno-first toolchain (Issue #224).

### Added

- `tests/verify_starfield_layout_check_test.ts`: unit tests for the ported
  starfield-layout verification logic.
- `deno.json` imports `npm:playwright` for headless browser automation used by
  the starfield layout verifier.

---

## [0.1.3] - 2026-05-24

### Security

- Widened `scripts/jsr_quarantine_check.ts` to gate **every** external ecosystem
  in `deno.json` `imports` — JSR, npm, and `deno.land/x` — and fail-closed on
  raw `https://`/`http://` tarball specifiers that cannot be age-checked (Issue
  #223, closes #216).
- The weekly upgrade workflow now allows the gate to reach `registry.npmjs.org`,
  `cdn.deno.land`, and `deno.land` in addition to `api.jsr.io`.

### Added

- `parseImportSpec` and `parseImports` in `scripts/jsr_quarantine_check.ts` now
  recognise `jsr:`, `npm:`, `deno.land/x/`, and raw `https://` specifiers.
- `fetchLatestVersionNpm` and `fetchLatestVersionDenoLandX` registry helpers for
  age-checking npm and deno.land/x packages.
- `isInternalImport` treats `@jsr/stsoftwareau__*` and `@stsoftwareau/*` npm
  packages as internal (no quarantine required).
- 14 new tests in `tests/jsr_quarantine_check_test.ts` covering each ecosystem,
  blocked/cleared classification, and fail-closed behaviour for raw URLs.

---

## [0.1.2] - 2026-05-24

### Added

- `quality` is now a **required status check** on the `Develop` branch (Issue
  #211): failures block PR merge instead of only showing a red tick.
- `.github/rulesets/develop.json`: settings-as-code mirror of the live GitHub
  Ruleset so branch-protection configuration is auditable in the repository.
- `tests/develop_ruleset_test.ts`: regression tests that pin the required-check
  list and catch accidental relaxation of the ruleset.
- README **Required checks** section under **Testing** explaining why the Merge
  button is disabled while Deno quality checks are red.

---

## [0.1.1] - 2026-05-24

### Security

- Hardened `.github/workflows/semver-bump.yml` against GH Actions
  script-injection: `${{ github.base_ref }}` is no longer interpolated directly
  into `run:` blocks — it is routed through `env: BASE_REF` and referenced as
  `"$BASE_REF"` (Issue #217).

### Added

- `tests/semver_bump_workflow_test.ts`: 6 tests verifying no direct
  `github.base_ref` / `github.head_ref` interpolation appears in any `run:`
  block, that `BASE_REF` is exposed via `env:`, and that no backslash-escaped
  quotes remain in `run:` blocks.

---

## [0.1.0] - 2025-12-19

The first tagged version of NEAT-AI Explore. This entry summarises the
capabilities present at `0.1.0` — earlier per-change history is preserved in the
git log and the `docs/pr-summary-*.md` files.

### Added

- **Trace Explorer** (`docs/index.html`): click an output neuron, follow inbound
  synapses upstream to observations, with a breadcrumb trail and sortable
  synapse rows (by `|weight|`, weight, or `|mean contribution|`).
- **Graph Explorer** (`docs/graph/index.html`): a 3D focus-centric neighbourhood
  view of the NEAT network, with desktop drag/zoom/WASD and touch (tap, long
  press, pinch, two-finger pan, swipe) controls.
- **Creature overview dashboard**: neuron/synapse counts, activation function
  distribution, network depth, and an interactive mini topology diagram.
- **Neuron detail cards**: type, squash (colour-coded badge), bias, impact
  score, recorded stats, inline activation sparkline, and error histogram.
- **Synapse colour coding**: green (excitatory), red (inhibitory), grey (weak),
  with a collapsible legend.
- **Reconstruction checks**: surfaces max value/activation deltas to flag
  recording or squash function mismatches.
- **Snapshot loading**: file picker, `?snapshotUrl=` / `?file=` parameters,
  `?snapshotUrlB64=` (base64url-encoded) for presigned URLs, transparent
  client-side gunzip via `DecompressionStream`, and a default snapshot
  auto-loaded when no query parameters are supplied.
- **PWA support**: `manifest.webmanifest`, service worker (`docs/sw.js`), icons
  and screenshots generated via `scripts/generate_pwa_assets.ts`.
- **Shared, DOM-free modules** under `docs/shared/` covering graph analysis,
  colour maps, snapshot loading, correlation, diagnostics scanning, sparklines,
  discovery, theme handling, touch gestures, and creature overview — each
  unit-tested in `tests/`.
- **Pure attribution modules** (`docs/impact_attribution.js`,
  `docs/impact_diagnostics.js`) imported by both the app and the test suite.
- **Tooling and CI**:
  - `quality.sh` (Deno fmt + lint + type check + test).
  - `.github/workflows/ci.yml`, `deno-quality.yml`, `markdown-lint.yml`,
    `shellcheck.yml`, `gitleaks.yml`, `dependency-review.yml`, `semgrep.yml`,
    `a11y.yml` (pa11y-ci against WCAG 2 AA), `deploy.yml` (GitHub Pages),
    `semver-bump.yml`, `upgrade-dependencies.yml`.
  - JSR quarantine gate (`scripts/jsr_quarantine_check.ts`) blocking
    freshly-published external dependencies during weekly upgrades.

### Security

- Snapshot loader rejects dangerous URL schemes (`javascript:`, `data:`) via
  `isDangerousUrlScheme` in `docs/shared/snapshot_loader.js`.
- Repository ships under the Apache Licence 2.0 (see `LICENSE`).

---

[Unreleased]: https://github.com/stSoftwareAU/NEAT-AI-Explore/compare/v0.1.6...HEAD
[0.1.6]: https://github.com/stSoftwareAU/NEAT-AI-Explore/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/stSoftwareAU/NEAT-AI-Explore/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/stSoftwareAU/NEAT-AI-Explore/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/stSoftwareAU/NEAT-AI-Explore/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/stSoftwareAU/NEAT-AI-Explore/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/stSoftwareAU/NEAT-AI-Explore/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/stSoftwareAU/NEAT-AI-Explore/releases/tag/v0.1.0
