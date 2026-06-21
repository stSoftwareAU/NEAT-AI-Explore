# Declare the licence in deno.json (Issue #363)

## Summary

Added the SPDX `license: "Apache-2.0"` field to `deno.json` so the licence
metadata lives in the manifest, not just the `LICENSE` file. This keeps the
licence machine-readable for manifest-reading tooling (Deno, JSR publishing,
SBOM and dependency-graph generators) and guarantees it stays in agreement with
the Apache-2.0 `LICENSE` file and the `README.md` badge. Closes #363.

## Evidence

Backend/manifest change with no web interface to screenshot. Verified via the
new unit tests and the full quality gate.

- `deno.json` now declares `"license": "Apache-2.0"` as the first top-level key.
- `./quality.sh` passes cleanly: **763 passed | 0 failed**.

## Test Plan

Added `tests/deno_json_license_test.ts` (TDD — failed before the change, passes
after):

- `deno.json declares the Apache-2.0 licence` — reads the manifest and asserts
  `license === "Apache-2.0"`.
- `deno.json licence matches the LICENSE file (Apache 2.0)` — asserts the
  manifest licence agrees with the Apache License, Version 2.0 text in
  `LICENSE`.
