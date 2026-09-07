/**
 * Tests for the pull-request dependency quarantine gate (#616).
 *
 * The 24-hour dependency-age quarantine — the repo's stated primary
 * supply-chain control — was wired into `upgrade-dependencies.yml` only,
 * which triggers on `schedule` / `workflow_dispatch`. A pull request that
 * hand-edited `deno.json` / `deno.lock` therefore adopted a dependency with
 * no publish-age verification whatsoever: `dependency-review.yml` and
 * `dependency-audit.yml` check disclosed advisories and licences, never
 * publish recency.
 *
 * These tests assert the gate now runs on pull requests, in resolved
 * (`--lock`) mode so transitive packages are covered too, and that its job
 * is listed in the Develop ruleset's required status checks so it cannot be
 * bypassed. Repo-wide policies (SHA pinning, checkout consistency, job
 * timeout, concurrency, persist-credentials) are enforced by their own
 * suites across every workflow and are not re-checked here.
 */

import { assert } from "./test_helpers.ts";
import {
  listWorkflowFiles,
  loadWorkflow,
  type Workflow,
  type WorkflowStep,
} from "./workflow_helpers.ts";

const QUARANTINE_WORKFLOW = "dependency-quarantine.yml";
const QUARANTINE_JOB = "dependency-quarantine";
const RULESET_PATH = new URL(
  "../.github/rulesets/develop.json",
  import.meta.url,
);

interface Ruleset {
  rules: Array<{
    type: string;
    parameters?: {
      required_status_checks?: Array<{ context: string }>;
    };
  }>;
}

/** Every `run:` script body across every job in a workflow. */
function collectRunScripts(wf: Workflow): string[] {
  const out: string[] = [];
  for (const job of Object.values(wf.jobs ?? {})) {
    for (const step of job?.steps ?? []) {
      if (typeof step.run === "string") out.push(step.run);
    }
  }
  return out;
}

function gateSteps(wf: Workflow): WorkflowStep[] {
  return (wf.jobs?.[QUARANTINE_JOB]?.steps ?? []).filter((s) =>
    typeof s.run === "string" && s.run.includes("jsr_quarantine_check.ts")
  );
}

Deno.test("a pull-request workflow runs the quarantine gate (#616)", async () => {
  const wf = await loadWorkflow(QUARANTINE_WORKFLOW);
  const triggers = wf.on;
  assert(
    triggers && typeof triggers === "object" && "pull_request" in triggers,
    `${QUARANTINE_WORKFLOW} must trigger on pull_request`,
  );
  assert(
    collectRunScripts(wf).some((s) => s.includes("jsr_quarantine_check.ts")),
    `${QUARANTINE_WORKFLOW} must run scripts/jsr_quarantine_check.ts`,
  );
});

Deno.test("the PR gate ages resolved lockfile versions, not just latest releases (#616)", async () => {
  const wf = await loadWorkflow(QUARANTINE_WORKFLOW);
  const steps = gateSteps(wf);
  assert(steps.length > 0, `${QUARANTINE_JOB} must have a gate step`);
  for (const step of steps) {
    const run = step.run ?? "";
    assert(
      /--lock(=|\s)/.test(run),
      "the PR gate must pass --lock so transitive resolutions are age-checked",
    );
    assert(
      run.includes("deno.lock"),
      "the PR gate must age-check deno.lock",
    );
  }
});

Deno.test("the PR gate reads the configured quarantine window (#616)", async () => {
  const wf = await loadWorkflow(QUARANTINE_WORKFLOW);
  for (const step of gateSteps(wf)) {
    const env = step.env ?? {};
    assert(
      "VIBE_BUMP_QUARANTINE_HOURS" in env,
      "the gate step must pass VIBE_BUMP_QUARANTINE_HOURS so the operator " +
        "window (default 24h) applies on pull requests too",
    );
  }
});

Deno.test("the PR gate reaches only the registries it age-checks against (#616)", async () => {
  const wf = await loadWorkflow(QUARANTINE_WORKFLOW);
  for (const step of gateSteps(wf)) {
    const run = step.run ?? "";
    assert(
      run.includes("--allow-net=api.jsr.io,registry.npmjs.org"),
      "the gate must run with a narrow --allow-net allowlist, got: " + run,
    );
    assert(
      !run.includes("--allow-all") && !/\s-A\b/.test(run),
      "the gate must not run with blanket permissions",
    );
  }
});

Deno.test("the quarantine job is a required status check on Develop (#616)", async () => {
  const ruleset = JSON.parse(
    await Deno.readTextFile(RULESET_PATH),
  ) as Ruleset;
  const rule = ruleset.rules.find((r) => r.type === "required_status_checks");
  assert(rule, "ruleset must include a 'required_status_checks' rule");
  const contexts = (rule!.parameters?.required_status_checks ?? []).map((c) =>
    c.context
  );
  assert(
    contexts.includes(QUARANTINE_JOB),
    `'${QUARANTINE_JOB}' must be a required status check so the gate cannot ` +
      `be bypassed, got: ${JSON.stringify(contexts)}`,
  );
  const wf = await loadWorkflow(QUARANTINE_WORKFLOW);
  assert(
    wf.jobs?.[QUARANTINE_JOB] !== undefined,
    `the required check '${QUARANTINE_JOB}' must name a job that exists in ` +
      QUARANTINE_WORKFLOW,
  );
});

Deno.test("every quarantine gate step can read the configured window (#616)", async () => {
  // Without `--allow-env` the gate dies on a permission error before it
  // age-checks a single package — a gate that can never pass never protects
  // anything, so both call sites must grant it.
  let checked = 0;
  for (const file of await listWorkflowFiles()) {
    const wf = await loadWorkflow(file);
    for (const job of Object.values(wf.jobs ?? {})) {
      for (const step of job?.steps ?? []) {
        const run = step.run ?? "";
        if (!run.includes("jsr_quarantine_check.ts")) continue;
        checked++;
        assert(
          run.includes("--allow-env=VIBE_BUMP_QUARANTINE_HOURS"),
          `${file}: the gate step must grant ` +
            "--allow-env=VIBE_BUMP_QUARANTINE_HOURS, got: " + run,
        );
      }
    }
  }
  assert(checked >= 2, `expected both gate call sites, found ${checked}`);
});
