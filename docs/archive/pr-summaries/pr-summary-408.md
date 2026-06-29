## Summary

Removed a HOW-assertion from the topology-modal focus-trap test and replaced it
with a WHAT-assertion against the controller's observable seam. Closes #408.

The old test in `tests/topo_modal_test.ts` reached into the mock modal's
internal event-listener registry and counted `keydown` listeners to infer that
the focus trap was installed and torn down. That pinned the _mechanism_ — it
assumed the trap is implemented as exactly one `keydown` listener on the modal
element. A behaviour-preserving refactor of `installFocusTrap` (e.g. trapping
via `focusin`, a document-level listener, or the `inert` attribute) would have
broken the test even though nothing observable changed.

The controller already accepts `installFocusTrap` as an injectable dependency
(`docs/shared/topo_modal.js:60`). The rewritten test injects a stub that counts
installs and releases, then asserts the contract: `open()` engages the trap
exactly once and `close()` releases it. This survives any reimplementation of
_how_ focus is trapped. The trapping behaviour itself remains covered
behaviourally by `tests/modal_focus_test.ts`.

`buildHarness()` gained an optional options-override argument so a test can
supply alternative controller dependencies without duplicating the harness.

## Evidence

Backend/test-only change — no web interface to screenshot. Verification is the
test suite:

- `deno test -A tests/topo_modal_test.ts` → `9 passed | 0 failed`
- `./quality.sh` → `735 passed | 0 failed`, `==> OK`

## Test Plan

- Rewrote `tests/topo_modal_test.ts` test _"createTopoModalController: focus
  trap is engaged on open, released on close"_ (formerly _"...installed on open,
  removed on close"_) to assert on the injectable `installFocusTrap` seam rather
  than the modal's internal keydown listener count.
- Extended `buildHarness()` to accept option overrides so the stub dependency
  can be injected.
- Confirmed the full Deno suite and `quality.sh` pass.
