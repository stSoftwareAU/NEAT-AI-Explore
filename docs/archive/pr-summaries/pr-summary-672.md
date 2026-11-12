## Summary

The `Ruleset Drift` check was red because the live rulesets differ from the
`.github/rulesets` mirror. The worker has no admin token
(`permissions.admin: false`), so live cannot be changed from here; the mirror
now follows live, which the README already names the source of truth (#658).

Closes #672.

- `develop.json`: `require_code_owner_review` is `false`, as on live.
- `milestone.json`: the `dependency-quarantine` required check is removed, as on
  live.
- `tests/codeowners_test.ts`: dropped the test asserting the mirror had
  `require_code_owner_review: true`; the CODEOWNERS file tests stay.
- `README.md`, `.github/CODEOWNERS` header, test header and ruleset `_comment`s
  no longer say code-owner review is enforced.
- Dependency Audit fix: `npm:jimp` is removed from `deno.json` and `deno.lock`
  (it pulled in a `zod` version affected by GHSA-mrhx-c7xc-m3w5).
  `scripts/raster.ts` (new, dependency-free: `boxBlur`, `resizeBicubic`,
  `encodePng`) replaces it in `scripts/generate_pwa_assets.ts`.

Version bump: no `version.json` change; the merged commit records the final
version.

## Spec

### Intent and Rationale

- The issue allows either an admin changing live or a deliberate mirror change.
  Only the latter is possible without admin rights; the drift check compares
  against live.

### Essential Design Decisions

- Assumption: live is the intended state (both live rulesets were last updated
  2026-10-25). If an admin wants stricter rules, they enable them on live and
  update the mirror and restore a test together.
- Develop still requires `dependency-quarantine` on live and in the mirror; only
  the milestone ruleset drops it.

### Undiscoverable Facts

- The weakened enforcement (no code-owner review, no quarantine on milestone
  branches) is already live; this PR only records it. Re-enabling needs an
  admin.

## Evidence

- Base branch: `deno task rulesets:check` reported both drifts quoted in the
  issue.
- This branch: `deno task rulesets:check` prints
  `2 rulesets in sync with stSoftwareAU/NEAT-AI-Explore` (unauthenticated, so
  `bypass_actors` is not compared; CI runs it with a token).
- Asset generator:
  `deno run -A --node-modules-dir=none scripts/generate_pwa_assets.ts` wrote the
  icons and favicon with the new helpers, then stopped at the screenshot step
  (Playwright browsers not installed here). All 12 `docs/icons/*.png` decoded
  through `createImageBitmap` at the expected sizes (16 to 512,
  `icon-source.png` 1024) and `docs/favicon.ico` was written (4770 bytes). The
  regenerated binaries were reverted, not committed.
- `./quality.sh` (final head): `ok | 1263 passed | 0 failed`, `==> OK`.

## Reproduction

- **symptom** — `deno task rulesets:check` fails with the two drift lines in the
  issue
- **status** — `verified` — the check failed on the base files and passes after
  the fix
- **regression test** — `scripts/check_ruleset_drift.ts` (run by
  `deno task rulesets:check`; the CI job `ruleset-drift`)

## Test Plan

- Removed from `tests/codeowners_test.ts`:
  `assertEquals(pr!.parameters?.require_code_owner_review, true, ...)` in
  "develop ruleset enables code-owner review (#361)"
  - Required by: "the mirror is deliberately changed to match live" (live has
    `false`; the drift check would otherwise fail).
- Added `tests/raster_test.ts` (10 tests at head), covering `scripts/raster.ts`.
  Added in review: 2-D `boxBlur` (3x3), 2-D `resizeBicubic` (8x4 to 4x2),
  `encodePng` decoded via `createImageBitmap` with IHDR bytes 24..28 and both
  scanlines checked, and a corrupted-CRC rejection control. Breaks checked red:
  `resizeAxis` vertical index `(line * w + t.i)` (gradient test), blur
  `stride = 4` (flat and 2-D blur tests), `ihdr[9] = 2` and a wrong CRC
  polynomial (PNG test).
- `deno task test` on the codeowners, drift, required-checks, quarantine and
  milestone-branch tests: passed.
- `./quality.sh`: passed.
- Not checked: `bypass_actors` comparison (needs a token the agent cannot read).
