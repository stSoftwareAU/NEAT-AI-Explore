## Summary

The README said the PR `dependency-quarantine` gate "is not yet a required
status check on the live `Develop` ruleset", and its required-checks table had
no row for it. Both live rulesets (`Develop` 11243690 and
`Vibe Coder milestone branches` 21880683) and both `.github/rulesets/` mirrors
require it, and #661 is closed. This PR corrects the README bullet, adds the
table row (Develop ✅, milestone ✅), fixes the "once drifted" sentence that
pointed at "the contexts above", and adds a test that fails when the table and
the ruleset mirrors disagree. Closes #674.

## Spec

### Intent and Rationale

- The README is what contributors read to judge whether a too-new dependency can
  merge, so it must match the enforced rulesets.
- The issue's optional suggestion was taken: a test compares the table with the
  mirrors. The mirrors are kept equal to live by `ruleset-drift.yml`, so the
  table now follows live too.

### Essential Design Decisions

- The milestone column is ✅, following the trusted 2026-11-12 issue comment
  (milestone ruleset now requires it), not the issue body's original `—`.
- The test parses only the `### Required checks (branch protection)` section's
  table and locates columns by header name. It reuses the file's existing
  `requiredContexts()`, `checkReporters()` and `loadCheckedInRulesets()`, so
  "required" means the same thing as in the #658 tests.
- Each row's workflow link must be the workflow whose job reports that check, so
  a row cannot point at the wrong file.

### Undiscoverable Facts

- Live state observed this run:
  `gh api repos/stSoftwareAU/NEAT-AI-Explore/rulesets/11243690` lists
  `update-version, a11y, gitleaks, markdownlint, dependency-review, semgrep,
  shellcheck, Quality Gate, dependency-quarantine`;
  ruleset 21880683 lists the same set without `update-version`.
  `gh issue view 661` shows it is `CLOSED`.

## Evidence

Docs and test only; no UI or runtime code changed.

- `tests/ruleset_required_checks_test.ts::README required-checks table matches the ruleset mirrors (#674)`
  failed against the unfixed README:
  `README.md required-checks table out of step with rulesets: missing [dependency-quarantine], extra []`,
  and passes after the README fix.
- Sections read and updated: `README.md` "PR dependency quarantine" bullet,
  "Required checks (branch protection)" table and the paragraph after it;
  "Code-owner review for privileged CI paths" already says
  `require_code_owner_review` is `true` on `Develop`, as the issue comment
  confirms, so it was left unchanged. `CHANGELOG.md` `[Unreleased]` → `Fixed`.
- Issue numbers cited: #661: Make dependency-quarantine a required status check
  on the live Develop and milestone rulesets; #674 (this issue).

## Test Plan

- Added
  `tests/ruleset_required_checks_test.ts::README required-checks table matches the ruleset mirrors (#674)`.
  It checks four things: every context the two mirrors require has a row, with
  no extra rows; each ✅ or — cell matches its ruleset (the `update-version` row
  has — in the milestone column, so the negative case is covered); each link
  names the workflow that reports the check; a missing section, column or
  context fails with a message. No existing assertion was removed.
- `deno test --allow-read tests/ruleset_required_checks_test.ts`: 3 passed.
- `./quality.sh < /dev/null` on the final head:
  `ok | 1264 passed (74 steps) | 0 failed`, `==> OK`.

Not done or not checked: no reviewer sub-agents were dispatched (the issue has
no acceptance-criteria list). The live rulesets were read once in this run; the
test checks the mirrors, not the live API.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
