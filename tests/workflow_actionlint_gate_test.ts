/**
 * Tests for the actionlint CI lint gate (#292).
 *
 * The repository ships several `.github/workflows/*.yml` files but had no CI
 * step that runs actionlint — the standard GitHub Actions linter. Without it,
 * workflow regressions (bad expressions, undefined `needs`, shellcheck issues
 * in `run:` blocks) can land unnoticed.
 *
 * These tests assert that a dedicated actionlint workflow exists and is wired
 * up to fail the build: it must run actionlint, trigger on pull requests, and
 * obey the repo-wide workflow policies (job timeout, PR concurrency). The
 * SHA-pinning and checkout-consistency policies are enforced by their own
 * dedicated tests across all workflows, so they are not re-checked here.
 */

import { parse as parseYaml } from "@std/yaml";
import { assert } from "./test_helpers.ts";

interface WorkflowStep {
  uses?: string;
  name?: string;
  run?: string;
}

interface WorkflowJob {
  "timeout-minutes"?: number;
  steps?: WorkflowStep[];
}

interface ConcurrencyBlock {
  group?: string;
  "cancel-in-progress"?: boolean;
}

interface Workflow {
  on?: Record<string, unknown> | string | string[];
  concurrency?: ConcurrencyBlock | string;
  jobs?: Record<string, WorkflowJob>;
}

const WORKFLOWS_DIR = new URL("../.github/workflows/", import.meta.url);
const ACTIONLINT_WORKFLOW = "actionlint.yml";

async function loadWorkflow(name: string): Promise<Workflow> {
  const url = new URL(name, WORKFLOWS_DIR);
  const text = await Deno.readTextFile(url);
  return parseYaml(text) as Workflow;
}

/** All `run:` script bodies across every job in a workflow. */
function collectRunScripts(wf: Workflow): string[] {
  const out: string[] = [];
  for (const job of Object.values(wf.jobs ?? {})) {
    for (const step of job?.steps ?? []) {
      if (typeof step.run === "string") out.push(step.run);
    }
  }
  return out;
}

function isPrTriggered(wf: Workflow): boolean {
  const triggers = wf.on;
  if (!triggers) return false;
  if (typeof triggers === "string") return triggers === "pull_request";
  if (Array.isArray(triggers)) return triggers.includes("pull_request");
  return "pull_request" in (triggers as Record<string, unknown>);
}

Deno.test("actionlint workflow exists and invokes the linter (#292)", async () => {
  const wf = await loadWorkflow(ACTIONLINT_WORKFLOW);
  const scripts = collectRunScripts(wf);
  assert(
    scripts.some((s) => /\bactionlint\b/.test(s)),
    "actionlint.yml must contain a run step that invokes `actionlint`",
  );
});

Deno.test("actionlint workflow runs on pull requests (#292)", async () => {
  const wf = await loadWorkflow(ACTIONLINT_WORKFLOW);
  assert(
    isPrTriggered(wf),
    "actionlint.yml must trigger on pull_request so regressions fail the build",
  );
});

Deno.test("actionlint workflow caps its job timeout (#292)", async () => {
  const wf = await loadWorkflow(ACTIONLINT_WORKFLOW);
  const jobs = Object.entries(wf.jobs ?? {});
  assert(jobs.length > 0, "actionlint.yml must define at least one job");
  for (const [name, job] of jobs) {
    const timeout = job?.["timeout-minutes"];
    assert(
      typeof timeout === "number" && Number.isInteger(timeout) && timeout > 0 &&
        timeout <= 60,
      `actionlint.yml job '${name}' must declare a positive timeout-minutes <= 60`,
    );
  }
});

Deno.test("actionlint workflow declares a cancelling concurrency group (#292)", async () => {
  const wf = await loadWorkflow(ACTIONLINT_WORKFLOW);
  const conc = wf.concurrency;
  assert(
    conc && typeof conc === "object",
    "actionlint.yml must declare a top-level concurrency block",
  );
  const group = (conc as ConcurrencyBlock).group ?? "";
  assert(
    group.includes("github.workflow") && group.includes("github.ref"),
    "concurrency.group must reference github.workflow and github.ref",
  );
  assert(
    (conc as ConcurrencyBlock)["cancel-in-progress"] === true,
    "actionlint.yml concurrency must set cancel-in-progress: true",
  );
});
