# Security Policy

NEAT-AI Explore is a static viewer for NEAT network snapshots. It ships no
server and stores no user data, so the main security surface is the **supply
chain** — the Deno dependencies pinned in [`deno.json`](deno.json) /
[`deno.lock`](deno.lock). This document is the single, discoverable place that
says who to contact about a suspected compromise and how to push an emergency
fix.

> **🇦🇺 Note:** This project uses Australian English in documentation (e.g.
> `behaviour`, `organisation`). Tool and Web API names keep their original
> spelling.

---

## 🛡️ Reporting a vulnerability

Please report suspected vulnerabilities **privately** — do **not** open a public
GitHub issue for an undisclosed vulnerability.

- Email **<security@stsoftware.com.au>**, or
- Use GitHub's **"Report a vulnerability"** flow under the repository's
  **Security** tab (private vulnerability reporting).

Include, where you can: the affected file or dependency, the version, a
description of the impact, and steps to reproduce. We aim to acknowledge a
report within a few working days.

---

## 🚨 Emergency dependency bump

Use this runbook when a dependency is found to ship a malicious or
actively-exploited version and the fix cannot wait for the scheduled weekly bump
(`.github/workflows/upgrade-dependencies.yml`).

1. **Identify the affected import** in [`deno.json`](deno.json) (and confirm the
   resolved version in [`deno.lock`](deno.lock)).
2. **Apply the fixed version.** Either bump in place:

   ```bash
   deno outdated --update --latest <pkg>
   ```

   or pin the known-good version directly in `deno.json`, then refresh the
   lockfile with `deno cache --reload`.
3. **Bypass the upgrade quarantine for an actively-exploited CVE.** The normal
   bump path runs an external-dependency quarantine gate
   (`scripts/jsr_quarantine_check.ts`) that rejects packages published less than
   `VIBE_BUMP_QUARANTINE_HOURS` (default 24h) ago. For a confirmed incident this
   delay is the wrong trade-off — apply the fix manually as in step 2 and open
   the PR directly, bypassing the scheduled `upgrade-dependencies.yml` run
   rather than waiting for the quarantine window to elapse. See the
   `SCR-QUARANTINE-OVERRIDE` finding for the broader override policy.
4. **Verify** the change locally:

   ```bash
   ./quality.sh < /dev/null
   ```

5. **Open a PR to `Develop`.** Reference the incident in the PR body. Once
   merged, production deploys via [`deploy.yml`](.github/workflows/deploy.yml).

---

## 🔗 Related

- Contributor-facing supply-chain conventions live in
  [`CONTRIBUTING.md`](CONTRIBUTING.md#-security-and-supply-chain).
- The dependency-update **quarantine window** itself is owned by the
  `security-scan` template and enforced by `scripts/jsr_quarantine_check.ts`.
- The emergency quarantine **bypass** path is tracked separately as the
  `SCR-QUARANTINE-OVERRIDE` finding.
