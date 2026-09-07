/**
 * Every `npm install -g` in a workflow must pin each package to an exact
 * version (Issue #617).
 *
 * A bare `npm install -g pa11y-ci http-server` resolves whatever the registry
 * serves at the moment the job runs, so a hijacked or maliciously republished
 * release executes on the runner as soon as it is published. A `run:` block is
 * not a manifest, so neither `deno.json`'s `minimumDependencyAge` nor
 * `scripts/jsr_quarantine_check.ts` covers it — the pin is the only gate.
 *
 * The check is general: it walks every workflow, extracts every `npm install`
 * command, and asserts each package argument carries an exact `@<version>`
 * suffix. Adding a new unpinned tool to any workflow fails this suite.
 */

import { assert } from "./test_helpers.ts";
import { listWorkflowFiles, loadWorkflow } from "./workflow_helpers.ts";

/** An exact semver pin — no range operators, no tags, no URLs. */
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * Split a package spec into name and version, handling scoped packages
 * (`@scope/name@1.2.3`) as well as plain ones (`name@1.2.3`).
 */
function splitSpec(spec: string): { name: string; version: string | null } {
  const at = spec.lastIndexOf("@");
  if (at <= 0) return { name: spec, version: null };
  return { name: spec.slice(0, at), version: spec.slice(at + 1) };
}

/**
 * Package arguments of every `npm install`/`npm i` command in a `run:` block.
 *
 * Each line is split into command segments (`&&`, `||`, `;`, `|`) and leading
 * keywords (`if`, `then`, `sudo`, …) are stripped, so only a segment that
 * genuinely starts with `npm install` is inspected — an `echo "npm install
 * failed"` diagnostic is not a command and contributes nothing. Flags are
 * dropped; a bare `npm install` (a lockfile-driven install) has no package
 * argument to pin.
 */
function npmInstallPackages(run: string): string[] {
  const packages: string[] = [];
  const LEADING_KEYWORDS = /^(?:if|then|else|elif|do|sudo|!|npx|time)\s+/;
  for (const rawLine of run.split("\n")) {
    const line = rawLine.split("#")[0];
    for (let segment of line.split(/&&|\|\||;|\|/)) {
      segment = segment.trim();
      while (LEADING_KEYWORDS.test(segment)) {
        segment = segment.replace(LEADING_KEYWORDS, "").trim();
      }
      const match = /^npm\s+(?:install|i)\b(.*)$/.exec(segment);
      if (!match) continue;
      for (const arg of (match[1] ?? "").trim().split(/\s+/)) {
        if (arg === "" || arg.startsWith("-")) continue;
        packages.push(arg);
      }
    }
  }
  return packages;
}

Deno.test(
  "every workflow npm install pins an exact package version (#617)",
  async () => {
    const unpinned: string[] = [];
    let checked = 0;
    for (const file of await listWorkflowFiles()) {
      const wf = await loadWorkflow(file);
      for (const [jobName, job] of Object.entries(wf.jobs ?? {})) {
        for (const step of job?.steps ?? []) {
          if (typeof step.run !== "string") continue;
          for (const spec of npmInstallPackages(step.run)) {
            checked++;
            const { name, version } = splitSpec(spec);
            if (version === null || !EXACT_VERSION.test(version)) {
              unpinned.push(`${file}:${jobName}: ${name} (spec "${spec}")`);
            }
          }
        }
      }
    }
    assert(
      checked > 0,
      "expected at least one npm install package argument across the " +
        "workflows — the extractor is no longer matching anything",
    );
    assert(
      unpinned.length === 0,
      "npm packages installed by a workflow must be pinned to an exact " +
        `version: ${unpinned.join(", ")}`,
    );
  },
);

Deno.test(
  "a11y installs pinned pa11y-ci and http-server (#617)",
  async () => {
    const wf = await loadWorkflow("a11y.yml");
    const packages = (wf.jobs?.a11y?.steps ?? [])
      .flatMap((step) =>
        typeof step.run === "string" ? npmInstallPackages(step.run) : []
      );
    for (const name of ["pa11y-ci", "http-server"]) {
      const spec = packages.find((p) => splitSpec(p).name === name);
      assert(
        spec !== undefined,
        `a11y job must install ${name}`,
      );
      assert(
        EXACT_VERSION.test(splitSpec(spec!).version ?? ""),
        `a11y job must pin ${name} to an exact version, got "${spec}"`,
      );
    }
  },
);
