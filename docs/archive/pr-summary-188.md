## Summary

Fixed a stored XSS in the inbound synapse renderer (`docs/app.js:2497`) where
the source neuron's `type` field — populated directly from snapshot JSON loaded
from a user-supplied URL — was interpolated into `innerHTML` without HTML
escaping. A malicious snapshot containing `{"type":"<img src=x onerror=...>"}`
could execute script in the `stsoftwareau.github.io` origin once the user opened
an inbound-synapse list referencing that neuron.

Closes #188.

The synapseFrom-cell markup is now built by a new pure helper,
`buildSynapseFromCellHtml` in `docs/shared/synapse_render.js`, which wraps the
neuron `type` value in `escapeHtml(…)` — matching the treatment already given to
every other snapshot-derived string in the same template. Centralising the
markup in a DOM-free module also makes the escaping regression-testable under
Deno.

## Evidence

This is a security fix for browser code; no UI change is visible. The regression
is verified by unit tests that drive the new helper with attacker payloads and
assert the output is escaped.

Data flow before/after the fix:

```mermaid
flowchart LR
    A[snapshot JSON<br/>creature.neurons[i].type] --> B[neuronsByUuid.get.type]
    B --> C{renderSynapseList}
    C -- before: raw interpolation --> D[innerHTML — XSS sink]
    C -- after: buildSynapseFromCellHtml --> E[escapeHtml type] --> F[innerHTML — safe]
```

## Test Plan

- Added `tests/synapse_render_test.ts` covering the new helper:
  - escapes the `<img src=x onerror=alert(1)>` payload from the issue
  - escapes ampersands and quotes in the `type` field
  - passes pre-escaped `nameHtml` through verbatim (no double-escape)
  - coerces non-string `type` values via `escapeHtml`
  - wraps output in the `synapseFrom` container
- Updated `docs/sw.js` STATIC_FILES to precache the new shared module (enforced
  by `tests/sw_static_files_test.ts`).
- `./quality.sh` passes cleanly: 480 tests, 0 failures.
