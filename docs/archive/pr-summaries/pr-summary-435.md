## Summary

Removed the unused export `BREADCRUMB_TRANSITION_MS` from `docs/shared/transitions.js`
and its assertions from `tests/transitions_test.ts`. Closes #435.

The constant was dead code: an identifier grep across every `.js`/`.ts` module
(excluding `docs/vendor/`) found it referenced only in the unit test — no
production module imported it and it was not re-exported from any barrel. The
breadcrumb slide/fade timing is genuinely CSS-owned via the
`--transition-breadcrumb: 200ms` custom property in `docs/styles.css` (applied in
the `.breadcrumb li` transitions and `breadcrumbSlideDeeper`/`breadcrumbSlideBack`
keyframes), so the JavaScript value was never read at runtime.

## Evidence

Backend/JS-constant change — no web UI surface to screenshot. Verified by:

- `grep -rn "BREADCRUMB_TRANSITION_MS"` (excluding `docs/vendor/`) returns no
  matches after the change.
- Confirmed CSS ownership: `docs/styles.css` drives the breadcrumb transition
  through `--transition-breadcrumb`, independent of the deleted JS constant.
- `./quality.sh` passes cleanly: **756 passed | 0 failed**.

## Test Plan

- Modified `tests/transitions_test.ts`: dropped the `BREADCRUMB_TRANSITION_MS`
  import and its two entries in the "all durations are positive numbers" and
  "all durations are at most 300 ms" loops. The remaining timing constants
  (`PANEL_CROSSFADE_MS`, `SYNAPSE_STAGGER_MS`, `SYNAPSE_STAGGER_CAP_MS`,
  `SYNAPSE_FADE_MS`, `CAMERA_FLY_MS`, `FOCUS_PULSE_MS`) are still asserted.
- Full suite run via `./quality.sh < /dev/null` — all tests pass, `deno lint`
  clean.
