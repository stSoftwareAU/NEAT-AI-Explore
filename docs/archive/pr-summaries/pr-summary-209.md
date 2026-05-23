## Summary

Fixed the five pre-existing `deno check` errors in `docs/evidence/_take_*.ts` so
the repo-wide type-check planned in #203 can pass. Pinned `astral` to the
already-cached `0.3.5` release across all three screenshot scripts and replaced
the unsupported `page.screenshot({ path: ... })` option with the current API
(`page.screenshot({ format: "png" })` returning PNG bytes that are written via
`Deno.writeFile`). Closes #209.

## Evidence

CLI/backend change — no UI surface to screenshot. Verified by:

- `deno check docs/evidence/` exits 0 (previously: 5 errors — 1×TS2307,
  4×TS2353).
- `deno check docs/` exits 0 (the broader-tree check that #203 will enable).
- `./quality.sh` passes locally — 519 tests, 0 failures.
- New regression test `tests/evidence_scripts_check_test.ts` runs
  `deno check docs/evidence/` as a subprocess and asserts a zero exit code plus
  absence of `TS2307`/`TS2353` strings in stderr.

## Test Plan

- Added `tests/evidence_scripts_check_test.ts` — spawns
  `deno check docs/evidence/` and asserts exit code 0, guarding against any
  future regression (unresolvable astral version, unsupported screenshot option,
  etc.).
- Confirmed every `page.screenshot` call in the three scripts still produces the
  same output PNG path it did before, only via `Deno.writeFile` instead of the
  removed `path` option.
- `./quality.sh` passes: `deno fmt --check`, `deno lint`,
  `deno check helpers/ scripts/ tests/`, `deno test -A` all green.
