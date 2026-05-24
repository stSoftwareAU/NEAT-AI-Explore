## Summary

Widened `scripts/jsr_quarantine_check.ts` so it gates **every** external
ecosystem in `deno.json` `imports` — JSR, npm, and `deno.land/x` — and
fail-closes on raw `https://`/`http://` tarball specifiers that cannot be
age-checked. The weekly upgrade workflow now allows the gate to reach
`registry.npmjs.org`, `cdn.deno.land`, and `deno.land` in addition to
`api.jsr.io`. This closes the npm/deno.land/x supply-chain bypass reported in
#216 and prepares the gate for the upcoming `npm:playwright` usage introduced by
#222.

Closes #223. Closes #216. Related to #222.

## Evidence

```mermaid
flowchart LR
    A[deno.json imports] --> P[parseImports]
    P --> J[jsr:@scope/name]
    P --> N[npm:name]
    P --> D[deno.land/x/name]
    P --> R[raw https:// → unsupported]
    J --> JF[api.jsr.io]
    N --> NF[registry.npmjs.org]
    D --> DF[cdn.deno.land]
    JF --> Q[checkImportQuarantine]
    NF --> Q
    DF --> Q
    Q --> G{young?}
    G -- yes --> B[blocked]
    G -- no  --> C[cleared]
    R --> U[unsupported]
    B & U --> X[exit 1]
    C --> O[OK]
```

Backend-only CLI change — no UI surface to screenshot. Verified by
`./quality.sh` (551 tests passing). New tests exercise each ecosystem through
`checkImportQuarantine` with mocked registry responses and assert routing,
blocked/cleared classification, and the fail-closed behaviour for raw URLs.

## Test Plan

Added to `tests/jsr_quarantine_check_test.ts`:

- `parseImportSpec recognises jsr/npm/deno.land/x and raw URLs`
- `parseImports extracts and dedupes across every ecosystem`
- `isInternalImport treats stSoftwareAU JSR + @stsoftwareau npm as internal`
- `fetchLatestVersionNpm reads dist-tags.latest + time map`
- `fetchLatestVersionNpm throws on missing latest dist-tag`
- `fetchLatestVersionDenoLandX reads versions.json + meta.json`
- `checkImportQuarantine blocks a fresh npm release`
- `checkImportQuarantine clears an older npm release`
- `checkImportQuarantine blocks a fresh deno.land/x release`
- `checkImportQuarantine clears an older deno.land/x release`
- `checkImportQuarantine refuses raw-url imports`
- `checkAll routes a bare https:// specifier to unsupported (fail-closed)`
- `checkAll inspects every ecosystem in a mixed imports map`
- `checkAll preserves existing JSR-only behaviour (regression)`

Existing JSR-only tests retained; the one assertion that inspected
`result.skipped[0].scope` was minimally adapted to narrow on the new
`ExternalImport` discriminated union (`skipped` widened from `JsrPackage[]` to
`ExternalImport[]`). All 551 tests pass under `./quality.sh`.
