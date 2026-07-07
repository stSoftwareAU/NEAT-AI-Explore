## Summary

Replaced a grep-as-assertion in `tests/astral_jsr_migration_test.ts` with a
behavioural check that asserts on each evidence script's _resolved module graph_
instead of the raw import-statement text. Closes #443.

The old case read each `docs/evidence/_take_*.ts` with `Deno.readTextFile` and
asserted `source.includes('from "@astral/astral"')` — a HOW-test that would go
red for a behaviour-preserving refactor (single vs double quotes, a line-wrapped
`import { … }`, an import-map alias, or a shared re-export barrel) despite no
real regression. The genuine contract is "the evidence scripts resolve against
the JSR astral package and the dead `deno.land/x/astral` channel is gone".

The rewritten case runs `deno info --json <script>`, walks the resolved module
graph, and asserts:

- some resolved specifier matches `jsr:@astral/astral@…` /
  `jsr.io/@astral/astral/` (the script genuinely resolves the JSR package), and
- no specifier references `deno.land/x/astral` (the abandoned channel is gone).

Because it asserts on resolution rather than statement text, the guard survives
import reformatting/aliasing/barrelling and only fails on a genuine regression
back onto `deno.land/x/astral` or a package that no longer resolves.

## Evidence

Backend/test-only change — no web UI to screenshot. Verified by running the
targeted test file and the full quality gate.

```
running 5 tests from ./tests/astral_jsr_migration_test.ts
deno.json pins @astral/astral to the JSR package ... ok
deno.lock has no orphaned deno.land/x/astral entries ... ok
deno.lock drops astral's stale deno.land/x transitives ... ok
deno.lock resolves the JSR astral specifier ... ok
evidence scripts resolve the JSR astral package, not deno.land/x ... ok
ok | 5 passed | 0 failed
```

`./quality.sh` → `756 passed | 0 failed` → `==> OK`.

```mermaid
flowchart LR
    A["_take_*.ts"] -->|deno info --json| B[resolved module graph]
    B --> C{jsr:@astral/astral<br/>present?}
    B --> D{deno.land/x/astral<br/>absent?}
    C -->|yes| E[pass]
    D -->|yes| E
```

## Test Plan

- Rewrote
  `tests/astral_jsr_migration_test.ts::evidence scripts resolve the JSR
  astral package, not deno.land/x`
  to resolve the module graph via `deno info --json` and assert on resolved
  specifiers rather than source text.
- Added the `resolveGraphSpecifiers` helper that shells out to `deno info` and
  collects every module/dependency specifier in the graph.
- Confirmed all five tests in the file pass and the full `./quality.sh` gate is
  green (756 tests).
