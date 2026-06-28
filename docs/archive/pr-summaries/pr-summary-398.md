## Summary

Removed the unused export `u01ToSigned` from `docs/shared/colour_maps.js`.
Module-graph analysis confirmed the helper `(u01) => (u01 * 2) - 1` was imported
only by its own unit test — no application code under `docs/**` imported or
called it, no sibling export within `colour_maps.js` used it, and it is not
re-exported from any barrel. A whole-repo search (including for dynamic/string
references) found no other call site. Removal is local to the module and its
test. Closes #398.

## Evidence

This is a dead-code removal with no web interface to screenshot. Verification:

- Repo-wide search before removal confirmed the only references were the export
  definition and `tests/colour_maps_test.ts`:

  ```
  tests/colour_maps_test.ts:10:  u01ToSigned,
  tests/colour_maps_test.ts:64:Deno.test("u01ToSigned maps 0 to -1", ...
  docs/shared/colour_maps.js:50:export function u01ToSigned(u01) {
  ```

- `./quality.sh` passes cleanly after the change (fmt, lint, type check, 742
  tests passed, 0 failed). The remaining `colour_maps_test.ts` suite (hash32,
  u32ToU01, neuron/synapse colour helpers) still imports and exercises the live
  exports, so the type check guarantees no dangling reference to the removed
  symbol.

## Test Plan

- Removed the three `u01ToSigned` assertions and its import from
  `tests/colour_maps_test.ts` (the symbol's only consumer); no behaviour remains
  to test.
- Ran `./quality.sh < /dev/null` — format check, lint, type check, and the full
  Deno test suite all pass (742 passed, 0 failed). The type check would fail if
  any remaining code still imported `u01ToSigned`.
