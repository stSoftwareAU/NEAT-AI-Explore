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

## 📋 Supported versions

Security fixes are applied to the current `0.1.x` release line, tracked in
[`version.json`](version.json). Older lines are not maintained — if you are on
an earlier release, upgrade to the latest `0.1.x` to receive fixes.

| Version | Supported |
| ------- | --------- |
| 0.1.x   | ✅ yes    |
| < 0.1   | ❌ no     |

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
   delay is the wrong trade-off — see **Emergency quarantine bypass** below for
   the deliberate override path.
4. **Verify** the change locally:

   ```bash
   ./quality.sh < /dev/null
   ```

5. **Open a PR to `Develop`.** Reference the incident in the PR body. Once
   merged, production deploys via [`deploy.yml`](.github/workflows/deploy.yml).

---

## ⏩ Emergency quarantine bypass

The quarantine window is a deliberate trade-off: it blocks freshly-published
malicious versions, but it also delays _legitimate_ freshly-published security
fixes. During an actively-exploited supply-chain incident the team may need to
take the fix **inside** the window. The override lever already exists — this
section is the documented, deliberate path so responders do not have to
improvise under pressure.

Both quarantine gates — `.github/workflows/upgrade-dependencies.yml` (the weekly
bump) and `.github/workflows/dependency-quarantine.yml` (every pull request, a
required status check) — read the window from the repository variable
`VIBE_BUMP_QUARANTINE_HOURS` (default `24`), so one lever moves both. The
upgrade workflow also exposes a `workflow_dispatch` trigger. To bypass the
window for a confirmed, actively-exploited advisory:

1. A repository **owner** sets the repository variable
   `VIBE_BUMP_QUARANTINE_HOURS` to `0` (**Settings → Secrets and variables →
   Actions → Variables**), _or_ applies the manual bump out-of-band as in steps
   1–2 of the runbook above.
2. Trigger **Upgrade Deno Dependencies** via `workflow_dispatch` (the **Run
   workflow** button on the Actions tab), so the gate runs with a zero-hour
   window and allows the fresh fix.
3. **Record the CVE and the override decision** in the resulting PR description,
   so the deliberate trade-off is auditable.
4. **Restore** `VIBE_BUMP_QUARANTINE_HOURS` to its default (`24`) once the fix
   has merged, re-arming both quarantine gates for routine bumps.

A hand-applied emergency bump (steps 1–2 of the runbook above) opens an ordinary
PR, so the required `dependency-quarantine` check applies to it as well: while
the repository variable is `0` the fresh version is allowed through, and the
window re-arms for every later PR the moment it is restored.

This override is intended only for an actively-exploited advisory where waiting
out the window is the greater risk. Outside an incident, leave the default
window in place.

---

## 🔗 Related

- Contributor-facing supply-chain conventions live in
  [`CONTRIBUTING.md`](CONTRIBUTING.md#-security-and-supply-chain).
- The dependency-update **quarantine window** itself is owned by the
  `security-scan` template and enforced by `scripts/jsr_quarantine_check.ts`, on
  the weekly bump (latest published versions) and on every pull request
  (versions resolved in `deno.lock`, direct and transitive).
- The emergency quarantine **bypass** path (`SCR-QUARANTINE-OVERRIDE`) is
  documented above under **Emergency quarantine bypass**.
