## Summary

Pinned the `semgrep/semgrep` container image in `.github/workflows/semgrep.yml`
to an immutable multi-arch manifest digest, matching the pattern already in
use in the sister repo `stSoftwareAU/NEAT-AI-Discovery`. The previous
declaration `image: semgrep/semgrep` resolved to whatever tag the Semgrep
maintainers (or anyone who compromised the Semgrep Docker Hub account) last
pushed — exposing `SEMGREP_APP_TOKEN` to whatever code the upstream image
contained at runtime. Closes #256.

The chosen digest is
`sha256:7cad2bc2d1e44f87f0bf4be6d1fa23aa90fb72015bebc89fb91385d813987a03`
(semgrep/semgrep 1.163.0), which is the digest the sister repo already
pins to.

## Evidence

This is a backend/CI-only change — no UI surface to screenshot. Verification
is via the new unit test which asserts the workflow's container image is
pinned in the form `semgrep/semgrep@sha256:<64-hex>`:

```
running 7 tests from ./tests/semgrep_workflow_test.ts
semgrep workflow file exists ... ok
semgrep workflow is valid YAML and named correctly ... ok
semgrep workflow triggers on pull_request ... ok
semgrep workflow uses minimal contents:read permissions ... ok
semgrep workflow runs in the semgrep container ... ok
semgrep container image is pinned to a sha256 digest (#256) ... ok
semgrep workflow checks out and runs semgrep ci ... ok
ok | 7 passed | 0 failed
```

The full quality gate (`./quality.sh`) passes with 729 tests.

## Test Plan

- Added `tests/semgrep_workflow_test.ts::semgrep container image is pinned to a sha256 digest (#256)` — asserts `jobs.semgrep.container.image` matches the regex `^semgrep/semgrep@sha256:[0-9a-f]{64}$`. This test fails against the pre-fix workflow (where the image was the bare reference `semgrep/semgrep`) and passes against the pinned form.
- Loosened the existing "runs in the semgrep container" assertion from an exact-string equality to a `startsWith` check, since the canonical image reference now includes a digest suffix.
