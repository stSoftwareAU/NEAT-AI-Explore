## Summary

Replaced the hand-rolled `interface Page` and its five `as unknown as Page`
double-casts in `scripts/generate_pwa_assets.ts` with Playwright's own `Page`
type. The double-cast disabled type checking at the browser-page boundary: if
Playwright's API drifted from the local interface, the compiler could not catch
the mismatch. The script now imports `type Page` from the already-resolved
`playwright` npm dependency, matching the repo's sibling verification scripts,
so `newPage()`'s real `Promise<Page>` return type flows through without any
cast. Closes #418

Changes:

- `import { chromium } from "playwright";` →
  `import { chromium, type Page } from "playwright";`
- Deleted the local `interface Page` (previously lines 580–598).
- Removed the `as unknown as Page` cast from all five `newPage()` call sites
  (desktop, mobile, iphone, ipad, graph).

No runtime behaviour changes — this is a type-safety cleanup only.

## Evidence

Backend/CLI change with no web interface to screenshot. Verified by type
checking and the existing regression test:

- `deno check scripts/generate_pwa_assets.ts` →
  `Check scripts/generate_pwa_assets.ts` (no errors).
- `./quality.sh` passes: fmt, lint, whole-repo type check, and 740 tests all
  green.

The helper signatures (`loadApp`, `openInboundModal`, `loadGraph`) now resolve
their `page: Page` parameters against the real Playwright API, so the string
arguments to `evaluate`/`waitForFunction` still type-check under the genuine
type.

## Test Plan

- Existing
  `tests/generate_pwa_assets_check_test.ts::deno check scripts/generate_pwa_assets.ts exits cleanly`
  is the behavioural contract for this change — it runs `deno check` on the
  script as a subprocess and asserts a zero exit code plus no `TS2307`/`TS2584`
  errors. It passes against the real Playwright `Page` type, confirming the cast
  removal did not introduce a type mismatch. No source-grep tests were added
  (they would break on any refactor and are disallowed by the repo's testing
  guidelines).
- Full `./quality.sh` run: `740 passed | 0 failed`.
