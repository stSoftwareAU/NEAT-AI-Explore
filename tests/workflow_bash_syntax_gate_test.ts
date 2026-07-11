/**
 * Tests for the bash `-n` syntax CI gate (#479).
 *
 * The repository ships bash scripts but had no CI step that runs `bash -n`
 * over them. Bash has no compile step, so a syntax error can land on the
 * default branch unnoticed. These tests assert that a dedicated workflow
 * exists and is wired to fail the build: it must invoke the committed gate
 * (`quality/bash_syntax.sh`) — or `bash -n` directly — trigger on pull
 * requests, cap its job timeout, declare a cancelling concurrency group, and
 * not persist the GITHUB_TOKEN to disk.
 *
 * SHA-pinning and checkout-consistency are enforced fleet-wide by their own
 * dedicated tests, so they are not re-checked here.
 */

import { parse as parseYaml } from "@std/yaml";
import { assert, assertEquals } from "./test_helpers.ts";

interface WorkflowStep {
  uses?: string;
  name?: string;
  run?: string;
  with?: Record<string, unknown>;
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
const BASH_SYNTAX_WORKFLOW = "bash-syntax.yml";

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

function checkoutSteps(job: WorkflowJob | undefined): WorkflowStep[] {
  return (job?.steps ?? []).filter((step) =>
    typeof step.uses === "string" &&
    step.uses.startsWith("actions/checkout@")
  );
}

Deno.test("bash-syntax workflow invokes the syntax gate (#479)", async () => {
  const wf = await loadWorkflow(BASH_SYNTAX_WORKFLOW);
  const scripts = collectRunScripts(wf);
  assert(
    scripts.some((s) =>
      /quality\/bash_syntax\.sh/.test(s) || /\bbash\s+-n\b/.test(s) ||
      /\bsh\s+-n\b/.test(s)
    ),
    "bash-syntax.yml must run `quality/bash_syntax.sh` or `bash -n` directly",
  );
});

Deno.test("bash-syntax workflow runs on pull requests (#479)", async () => {
  const wf = await loadWorkflow(BASH_SYNTAX_WORKFLOW);
  assert(
    isPrTriggered(wf),
    "bash-syntax.yml must trigger on pull_request so regressions fail the build",
  );
});

Deno.test("bash-syntax workflow caps its job timeout (#479)", async () => {
  const wf = await loadWorkflow(BASH_SYNTAX_WORKFLOW);
  const jobs = Object.entries(wf.jobs ?? {});
  assert(jobs.length > 0, "bash-syntax.yml must define at least one job");
  for (const [name, job] of jobs) {
    const timeout = job?.["timeout-minutes"];
    assert(
      typeof timeout === "number" && Number.isInteger(timeout) && timeout > 0 &&
        timeout <= 60,
      `bash-syntax.yml job '${name}' must declare a positive timeout-minutes <= 60`,
    );
  }
});

Deno.test("bash-syntax workflow declares a cancelling concurrency group (#479)", async () => {
  const wf = await loadWorkflow(BASH_SYNTAX_WORKFLOW);
  const conc = wf.concurrency;
  assert(
    conc && typeof conc === "object",
    "bash-syntax.yml must declare a top-level concurrency block",
  );
  const group = (conc as ConcurrencyBlock).group ?? "";
  assert(
    group.includes("github.workflow") && group.includes("github.ref"),
    "concurrency.group must reference github.workflow and github.ref",
  );
  assertEquals(
    (conc as ConcurrencyBlock)["cancel-in-progress"],
    true,
    "bash-syntax.yml concurrency must set cancel-in-progress: true",
  );
});

Deno.test("bash-syntax checkout does not persist the GITHUB_TOKEN (#479)", async () => {
  const wf = await loadWorkflow(BASH_SYNTAX_WORKFLOW);
  const steps = checkoutSteps(wf.jobs?.["bash-syntax"]);
  assert(
    steps.length > 0,
    "bash-syntax job must have an actions/checkout step",
  );
  for (const step of steps) {
    assert(
      step.with !== undefined && step.with !== null,
      "bash-syntax checkout must set `with.persist-credentials: false`",
    );
    assertEquals(
      step.with["persist-credentials"],
      false,
      "bash-syntax checkout must set `persist-credentials: false`",
    );
  }
});
