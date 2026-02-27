## Summary

Extract duplicated utility functions from `app.js` and `graph.js` into shared
modules under `docs/shared/`, eliminating copy-pasted code and enabling unit
testing. Closes #125.

### What changed

| Duplicated function                                      | Shared module                                        | Notes                                                                                                                               |
| -------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `escapeHtml`                                             | `docs/shared/ui_helpers.js`                          | Identical in both files                                                                                                             |
| `normaliseCreature`                                      | `docs/shared/creature_normaliser.js`                 | Unified into pure function returning `{ creature, neuronsByUuid, synapses, inboundByTo }`                                           |
| `loadInputLabelsFromSnapshot` / `loadLabelsFromSnapshot` | `docs/shared/alias_registry.js`                      | `buildAliasRegistry()` returns immutable registry; callers assign to their module-level state                                       |
| Allowed origins list                                     | `docs/shared/config.js` (`ALLOWED_SNAPSHOT_ORIGINS`) | `app.js` now uses the shared constant; `sw.js` keeps its copy (cannot use ES imports) with a comment pointing to the canonical list |

DOM-dependent functions (`setStatus`, `showProgress`, `updateProgress`,
`hideProgress`) and `autoLoadWithRetry` (which depends on view-specific globals
like `SNAPSHOT` and `loadSnapshot`) remain in their respective view files — they
cannot be meaningfully shared without introducing unnecessary abstraction.

### Net effect

- **~150 lines of duplicated code removed** from `app.js` and `graph.js`
- **3 new shared modules** created (pure, DOM-free, testable)
- **28 new unit tests** across 3 test files + 3 config tests for
  `ALLOWED_SNAPSHOT_ORIGINS`
- Both views continue to work correctly
- `./quality.sh` passes cleanly (338 tests, 0 failures)

## Evidence

This is a backend/module refactoring with no visual changes. Evidence is
provided by the test suite:

- `tests/ui_helpers_test.ts` — 8 tests covering escapeHtml
- `tests/creature_normaliser_test.ts` — 10 tests covering normaliseCreature
- `tests/alias_registry_test.ts` — 7 tests covering buildAliasRegistry
- `tests/config_test.ts` — 3 new tests for ALLOWED_SNAPSHOT_ORIGINS
- `tests/sw_static_files_test.ts` — existing tests verify new modules are in SW
  cache

## Test Plan

- Added `tests/ui_helpers_test.ts` (8 tests)
- Added `tests/creature_normaliser_test.ts` (10 tests)
- Added `tests/alias_registry_test.ts` (7 tests)
- Extended `tests/config_test.ts` with 3 tests for `ALLOWED_SNAPSHOT_ORIGINS`
- All 338 tests pass via `./quality.sh`
