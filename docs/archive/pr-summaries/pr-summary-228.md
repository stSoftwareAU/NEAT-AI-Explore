## Summary

Refreshed `deno.lock` via `deno cache --reload` after the Python Playwright
port-out (#224–#227) landed, and added regression tests that pin the
single-language stack so orphan `npm:playwright*` entries and Python artefacts
cannot creep back in. Closes #228.

The lockfile previously carried four stale `npm:playwright*` specifiers that no
source file imported any more. After the reload only the single pinned
`npm:playwright@1.60.0` (from `deno.json`'s `imports` map) remains.

## Evidence

### deno.lock specifier diff

Removed (orphan playwright specifiers — no real importer):

```
- npm:@playwright/test@*       -> 1.58.2
- npm:playwright@*             -> 1.60.0
- npm:playwright@1.49.1        -> 1.49.1
- npm:playwright-core@1.52.0   -> 1.52.0
```

Remaining (single pinned, real importer in `deno.json`):

```
+ npm:playwright@1.60.0        -> 1.60.0
```

The reload also bumped a handful of `jsr:@std/*` packages to their latest patch
within the existing caret ranges (and dropped a stale `jsr:@std/assert@*`
orphan). These are the natural consequence of `deno cache --reload` and were not
pinned to older versions.

### Repository sweep

```text
$ find scripts/ -name "*.py"
(no results)
$ find . -name "requirements*.txt" -o -name "pyproject.toml"
(no results)
$ grep -rn "playwright" --include="*.py" .
(no results)
$ grep -rn "pip install.*playwright" README.md CONTRIBUTING.md
(no results)
```

### Single-language stack flow

```mermaid
flowchart LR
    A[Deno test runner] --> B[deno.json imports]
    B -->|npm:playwright@1.60.0| C[npm:playwright]
    B -->|npm:jimp@1.6.1| D[npm:jimp]
    C --> E[scripts/*.ts evidence captures]
    D --> E
```

### Quality gate

`./quality.sh` is green: `572 passed | 0 failed`.

## Test Plan

Added `tests/deno_lock_playwright_test.ts` with five regressions:

- `deno.lock has no orphan playwright specifiers` — asserts exactly one
  `npm:playwright*` key in `specifiers`.
- `deno.lock playwright specifier matches the deno.json pin` — asserts the lock
  entry equals the pinned import.
- `no Python files remain under scripts/`.
- `no Python project metadata files remain at repo root` — guards
  `pyproject.toml`, `requirements*.txt`.
- `README/CONTRIBUTING contain no Python Playwright install instructions` —
  guards reintroduction of `pip install ... playwright` prose.

All existing tests continue to pass.
