## Summary

Extract duplicated utility functions from `app.js` and `graph/graph.js` into
shared modules to eliminate copy-paste duplication, enable linting, and make the
logic unit-testable. Closes #125.

### What was extracted

| Function                                            | Source                                                                       | Destination                      |
| --------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------- |
| `escapeHtml`                                        | app.js + graph.js                                                            | `docs/shared/ui_helpers.js`      |
| `extractTooltips` (label/description/group loading) | app.js (`loadInputLabelsFromSnapshot`) + graph.js (`loadLabelsFromSnapshot`) | `docs/shared/ui_helpers.js`      |
| `normaliseCreature` (creature schema normalisation) | app.js + graph.js                                                            | `docs/shared/snapshot_loader.js` |
| `ALLOWED_SNAPSHOT_ORIGINS` (allowed origin list)    | app.js + sw.js (hardcoded)                                                   | `docs/shared/config.js`          |

### Allowed-origin centralisation

The allowed snapshot origins (`stsoftwareau.github.io`,
`raw.githubusercontent.com`) are now exported as `ALLOWED_SNAPSHOT_ORIGINS` from
`docs/shared/config.js`. Both `app.js` and `sw.js` reference this canonical
list. The service worker keeps a local copy (since SW cannot use ES module
imports) with a comment pointing to the canonical source.

## Evidence

Both views continue to work correctly after the refactoring:

### Trace explorer

![Trace explorer](docs/evidence/trace-explorer.png)

### Graph explorer

![Graph explorer](docs/evidence/graph-explorer.png)

## Test Plan

- Added `tests/ui_helpers_test.ts` — 14 tests covering `escapeHtml` and
  `extractTooltips`
- Added `tests/normalise_creature_test.ts` — 9 tests covering
  `normaliseCreature` (UUID normalisation, invalid synapse filtering, synthetic
  input neurons, inboundByTo indexing)
- Added 4 tests to `tests/config_test.ts` for `ALLOWED_SNAPSHOT_ORIGINS`
- All 337 tests pass, `./quality.sh` passes cleanly
