## Summary

Removed the unused export `SYNAPSE_FADE_MS` from `docs/shared/transitions.js`.
An identifier grep across every `.js` module (excluding `docs/vendor/`) confirmed
the constant was referenced only by its own unit test — no production module
imported it and it was not re-exported from any barrel. The synapse-row fade
timing is CSS-owned (`--transition-synapse-fade: 180ms` in `docs/styles.css`,
applied via the `synapseFadeIn` keyframe animation), so the JavaScript value was
never read at runtime. Removed the dead export and its assertions from
`tests/transitions_test.ts`. Closes #436.

**Reviewer caveat confirmed:** the fade timing is CSS-owned. `docs/styles.css`
defines `--transition-synapse-fade: 180ms` and `.synapseRow.fadeIn` uses it via
`animation: synapseFadeIn var(--transition-synapse-fade) ...`. No JS animation
reads the constant.

## Evidence

Backend/shared-module change with no web UI surface to screenshot. Verified by
the Deno test suite via `./quality.sh` (format, lint, test):

```
ok | 756 passed | 0 failed (15s)
==> OK
```

Reference confirming no remaining importers (excluding `docs/vendor/`):

```
$ grep -rn "SYNAPSE_FADE_MS" --include="*.js" --include="*.ts" .
# (no results after removal)
```

## Test Plan

- Removed the `SYNAPSE_FADE_MS` import and its two assertions from
  `tests/transitions_test.ts` (the "all durations are positive numbers" and
  "all durations are at most 300 ms" loops).
- The remaining `transitions_test.ts` cases (`PANEL_CROSSFADE_MS`,
  `SYNAPSE_STAGGER_MS`, `SYNAPSE_STAGGER_CAP_MS`, `CAMERA_FLY_MS`,
  `FOCUS_PULSE_MS`, `prefersReducedMotion`, `synapseStaggerDelay`) continue to
  pass, confirming the removal did not affect the still-used exports.
- Full quality gate passes: `./quality.sh` → 756 passed, 0 failed.
