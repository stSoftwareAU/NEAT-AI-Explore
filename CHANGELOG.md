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
  and screenshots generated via `scripts/generate_pwa_assets.py`.
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

[Unreleased]: https://github.com/stSoftwareAU/NEAT-AI-Explore/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/stSoftwareAU/NEAT-AI-Explore/releases/tag/v0.1.0
