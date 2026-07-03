## Summary

Added an `assertNever` exhaustiveness helper to `scripts/jsr_quarantine_check.ts` and a
`default` branch calling it to all four `switch (imp.kind)` statements that discriminate on
the `ExternalImport` union (`importKey`, `importDisplayName`, `checkImportQuarantine`, and
`describeSkipped`). If a fifth `kind` is ever added to the union, each `default` branch now
fails to type-check (its argument is no longer `never`), turning a future variant into a
localised **compile-time** error instead of a silent runtime bug (missing return, or an
unassigned `v`/`kind`/`display` in the `break`-based switch).

The helper is Deno-native — no new tooling or dependencies. Closes #421.

## Evidence

Backend/CLI change with no web interface to screenshot. Verified via type-check and tests:

- `deno check scripts/jsr_quarantine_check.ts` — passes (a rogue variant would now fail here).
- `deno test -A tests/jsr_quarantine_check_test.ts` — 32 passed, 0 failed.
- `./quality.sh` — 748 passed, 0 failed, `==> OK`.

## Test Plan

- Added `tests/jsr_quarantine_check_test.ts::assertNever throws for an unhandled ExternalImport kind`
  — calls the exported helper with a simulated future variant and asserts it throws with the
  expected `Unhandled ExternalImport kind` message including the rogue value.
- Added `tests/jsr_quarantine_check_test.ts::importDisplayName handles every current ExternalImport kind`
  — exercises all four existing variants through a switch that now carries the `default` guard,
  confirming the added branch does not regress current behaviour.
