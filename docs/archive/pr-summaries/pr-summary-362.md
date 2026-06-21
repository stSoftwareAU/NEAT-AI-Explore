## Summary

Issue #362 asked for a `SECURITY.md` carrying a vulnerability disclosure policy
with three elements: a **private reporting route**, an **expected response
time**, and a **supported-versions table**.

A root-level `SECURITY.md` already existed (added by #365/#366) covering the
private reporting route (`security@stsoftware.com.au` + GitHub private
vulnerability reporting) and the response time ("within a few working days"),
but it had **no supported-versions table**. This PR closes that last gap by
adding a **Supported versions** section tied to the current `0.1.x` release line
tracked in `version.json`. Closes #362.

## Evidence

This is a docs/CLI-only change with no web interface to screenshot. The
behaviour is verified by the `tests/security_policy_test.ts` suite, which
asserts the structural contents of `SECURITY.md` rather than exact wording.

New section rendered:

| Version | Supported |
| ------- | --------- |
| 0.1.x   | ✅ yes    |
| < 0.1   | ❌ no     |

Full quality gate passes:

```
ok | 761 passed | 0 failed (2s)
==> OK
```

## Test Plan

- Added
  `tests/security_policy_test.ts::SECURITY.md documents a supported-versions table (#362)`
  — fails against the pre-change file (no "Supported versions" section) and
  passes after the section is added. Asserts both the heading and the rendered
  table row.
- Re-ran the existing four `security_policy_test.ts` checks (private contact,
  emergency bump, quarantine override) — all still pass; no existing tests were
  modified or removed.
- `./quality.sh < /dev/null` — fmt, lint, type check, and the full 761-test
  suite pass cleanly.
