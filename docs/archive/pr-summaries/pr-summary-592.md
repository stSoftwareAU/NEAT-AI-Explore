## Summary

Removed the superseded JSR-only exports `parseJsrImports` and `checkQuarantine`
from `scripts/jsr_quarantine_check.ts`. Both were the first-generation, JSR-only
quarantine gate; since #223 the CLI entry (`import.meta.main` → `checkAll`) has
run the multi-registry pipeline instead — `parseImports` / `parseImportSpec` for
parsing and `checkImportQuarantine` for the age check, covering JSR, npm and
deno.land/x. Neither legacy function had a caller anywhere in the production
path. Closes #592.

Rather than deleting their tests, the dedicated tests were **repointed** at the
surviving multi-registry functions. That preserves every JSR scenario the legacy
pair covered and closes a real gap: `checkImportQuarantine` previously had
blocked/cleared tests for npm and deno.land/x but none for the JSR age window
(JSR was only exercised indirectly through `checkAll`).

```mermaid
flowchart LR
    CLI["CLI entry\nimport.meta.main"] --> CA["checkAll"]
    CA --> PI["parseImports\n→ parseImportSpec"]
    CA --> CIQ["checkImportQuarantine"]
    CIQ --> J["fetchLatestVersion\nJSR"]
    CIQ --> N["fetchLatestVersionNpm"]
    CIQ --> D["fetchLatestVersionDenoLandX"]
    PJI["parseJsrImports\nREMOVED"]:::gone
    CQ["checkQuarantine\nREMOVED"]:::gone
    classDef gone stroke-dasharray: 4 4,color:#888,stroke:#888
```

### Safety checks before removal

- Repo-wide grep (word-boundary, so `checkImportQuarantine` was not conflated
  with `checkQuarantine`) over `docs/`, `helpers/`, `scripts/`, `tests/` and
  `.github/`: the only references were the imports and tests in
  `tests/jsr_quarantine_check_test.ts`. Remaining mentions live in historical
  `docs/archive/` PR summaries, which are immutable records and were left alone.
- `.github/workflows/upgrade-dependencies.yml` invokes the script only via its
  CLI entry (`deno run … scripts/jsr_quarantine_check.ts deno.json`), never by
  symbol — no dynamic or reflective use.
- `JsrPackage` was **kept**: it is still the parameter type for `isInternal` and
  `fetchLatestVersion`.

This script is supply-chain critical, and the gate's runtime behaviour is
unchanged — nothing on the executed path was touched.

## Evidence

Backend/CLI change with no web interface, so no screenshot applies. Verified by
test suite and type check instead:

- `deno check scripts/jsr_quarantine_check.ts` — passes.
- `deno test -A tests/jsr_quarantine_check_test.ts` — **32 passed, 0 failed**
  (same count as before the change; the legacy tests were repointed, not
  dropped).
- `./quality.sh < /dev/null` — **1105 passed (64 steps), 0 failed** → `==> OK`.

## Test Plan

Modified in `tests/jsr_quarantine_check_test.ts` — eight tests repointed from
the removed functions to the surviving ones, keeping identical fixtures and
assertions:

| Was                                                        | Now                                                                          |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `parseJsrImports extracts scope/name…`                     | `parseImports extracts scope/name from JSR import specifiers`                |
| `parseJsrImports deduplicates packages…`                   | `parseImports deduplicates JSR packages referenced by multiple entrypoints`  |
| `checkQuarantine flags a package… younger than the window` | `checkImportQuarantine flags a JSR package whose latest version is younger…` |
| `checkQuarantine clears a package… older than the window`  | `checkImportQuarantine clears a JSR package whose latest version is older…`  |
| `checkQuarantine ignores yanked versions…`                 | `checkImportQuarantine ignores yanked JSR versions when picking the latest`  |
| `checkQuarantine accepts bare-array response shape`        | `checkImportQuarantine accepts the bare-array JSR response shape`            |
| `checkQuarantine throws… non-OK status`                    | `checkImportQuarantine throws if the JSR registry returns a non-OK status`   |
| `checkQuarantine throws… no usable versions`               | `checkImportQuarantine throws if the JSR package has no usable… versions`    |

Per the "do not remove existing tests" rule, this business-logic change is
documented explicitly: no test was deleted or commented out — each was
re-targeted at the function that now owns the behaviour, and the blocked /
cleared cases additionally assert `kind === "jsr"` to confirm correct ecosystem
routing.
