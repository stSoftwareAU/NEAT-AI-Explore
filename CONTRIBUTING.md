# Contributing to NEAT-AI Explore

Thanks for your interest in NEAT-AI Explore — a static viewer for NEAT network
snapshots. This guide covers how to set up a local dev environment, the branch
model, and the conventions every PR is expected to follow.

> **🇦🇺 Note:** This project uses Australian English in code, comments, and
> documentation (e.g. `colour`, `behaviour`, `organisation`). CSS standards like
> `prefers-color-scheme` and JavaScript Web API names keep their original
> spelling.

---

## 🧰 Prerequisites

- [Deno](https://deno.com/) (a recent stable release; `quality.sh` runs
  `deno upgrade` on a best-effort basis).
- A POSIX shell (`bash`) for running `quality.sh`.
- (Optional) Playwright's Chromium binary if you want to regenerate PWA icons
  and screenshots via `scripts/generate_pwa_assets.ts`. Install it once with
  `deno run -A --node-modules-dir=none npm:playwright install chromium`.

No `node_modules`, no build step — the app is plain HTML/JS/CSS served from
`docs/`.

---

## 🚀 Local development

Serve the published folder with any static HTTP server:

```bash
cd docs
python3 -m http.server 8000
```

Then open `http://localhost:8000`. See the [Quick Start](README.md#-quick-start)
section of the README for the available URL parameters (`?snapshotUrl=`,
`?snapshotUrlB64=`, etc.).

---

## 🌿 Branch model

- **Default branch**: `Develop`. All PRs target `Develop`.
- **Feature branches**: create a topic branch from `Develop`, e.g.
  `issue-NNN-short-slug`. Keep the branch focused on a single concern.
- **Main**: reserved for production releases (deployed to GitHub Pages by
  `.github/workflows/deploy.yml`).

```mermaid
gitGraph
    commit id: "Develop"
    branch issue-NNN-feature
    commit id: "work"
    commit id: "tests"
    checkout Develop
    merge issue-NNN-feature tag: "PR merged"
    commit id: "next change"
```

---

## ✅ Quality gate

Every PR must pass `./quality.sh` cleanly before review. The script runs:

1. `deno fmt --check` — formatting (Deno is strict; run `deno fmt` to fix).
2. `deno lint` — linting (config in [`deno.json`](deno.json)).
3. `deno check helpers/ scripts/ tests/` — TypeScript type checking.
4. `deno test -A` — full test suite (Deno tests in `tests/`).

Run locally (always redirect stdin on unattended machines):

```bash
./quality.sh < /dev/null
```

If a check fails, fix the underlying issue rather than excluding files or
loosening the rule. The lint/format exclusions in `deno.json` are intentionally
narrow (vendor bundles and a small set of browser-only entry points).

---

## 🧪 Tests

- Tests live in `tests/` and are written in Deno TypeScript.
- Write **"what" tests**: import a module, call a function with known inputs,
  and assert on the result. Do **not** write tests that read source files as
  text and grep for implementation patterns — those break on any refactor and
  verify nothing useful.
- Browser-only code (DOM, WebGL, Service Worker) cannot be exercised in Deno;
  skip it rather than faking it.
- See the README's [Testable Modules](README.md#what-can-be-unit-tested) table
  for the canonical list of pure, DOM-free modules.

```bash
# Run all tests
deno test -A

# Run a single test file
deno test -A tests/snapshot_loader_test.ts

# Auto-fix formatting before committing
deno fmt
```

---

## 📝 PR conventions

Every PR ships a Markdown summary at `docs/pr-summary-NNN.md`, where `NNN` is
the issue number the PR closes. This file is committed alongside the change and
is also used as the PR body.

The summary must include:

1. **Summary** — what changed and why, including a GitHub closing keyword (e.g.
   `Closes #NNN`).
2. **Evidence** — appropriate to the change:
   - UI changes: a screenshot (saved under `docs/evidence/`).
   - Performance changes: before/after benchmark numbers.
   - Backend/CLI/docs: tests or command output that verify the change.
3. **Test Plan** — the tests added or modified, and any manual verification.

For architectural, workflow, or sequence-of-events changes include a **Mermaid**
diagram (`flowchart`, `sequenceDiagram`, `stateDiagram`, `gitGraph`, ...).
GitHub renders Mermaid blocks natively.

### Versioning

- `version.json` is the source of truth for the SemVer string.
- The `.github/workflows/semver-bump.yml` action auto-increments the **patch**
  version on PRs that don't update `version.json` themselves. Bump
  **minor**/**major** manually when the change warrants it.
- Add an entry to [`CHANGELOG.md`](CHANGELOG.md) under `## [Unreleased]` (or a
  new version heading) describing the user-visible effect of your change. The
  format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

### Commit messages

- Reference the issue number in the body (e.g. `Refs #207`, `Closes #207`).
- Keep the subject line short and imperative.
- Group related changes into a single commit where practical; avoid mixing
  unrelated refactors with feature work.

---

## 🔒 Security and supply chain

- Do not commit secrets, dotenv files, or `*.config*.json`. The repo's
  `.gitignore` and pre-commit safety net block hidden paths by default.
- Dependency bumps go through `.github/workflows/upgrade-dependencies.yml`,
  which runs a JSR quarantine check (`scripts/jsr_quarantine_check.ts`) before
  applying updates. External packages younger than the quarantine window are
  rejected.
- GitHub Actions are pinned to commit SHAs, not floating tags. Keep them that
  way.

---

## 🙋 Getting help

Open a GitHub issue with the `question` label (or comment on an existing issue).
For larger design conversations, sketch a Mermaid diagram in the issue body — a
picture saves a thousand words.
