/**
 * Tests for the ShellCheck CI gate (#480).
 *
 * The repository ships bash scripts but lacked a CI step that lints them with
 * shellcheck via a committed, locally-runnable gate. These tests assert that
 * the shellcheck workflow is wired to fail the build: it must invoke the
 * committed gate (`quality/shellcheck.sh`) — or `shellcheck` directly — trigger
 * on pull requests, cap its job timeout, and declare a cancelling concurrency
 * group.
 *
 * Checkout persist-credentials handling is covered by the consolidated policy
 * suite (`workflow_persist_credentials_test.ts`), so it is not re-checked
 * here.
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
const SHELLCHECK_WORKFLOW = "shellcheck.yml";

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

/** All `uses:` action references across every job in a workflow. */
function collectUses(wf: Workflow): string[] {
  const out: string[] = [];
  for (const job of Object.values(wf.jobs ?? {})) {
    for (const step of job?.steps ?? []) {
      if (typeof step.uses === "string") out.push(step.uses);
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

Deno.test("shellcheck workflow invokes the shellcheck gate (#480)", async () => {
  const wf = await loadWorkflow(SHELLCHECK_WORKFLOW);
  const scripts = collectRunScripts(wf);
  const uses = collectUses(wf);
  const invokesGate = scripts.some((s) =>
    /quality\/shellcheck\.sh/.test(s) || /\bshellcheck\b/.test(s)
  );
  const usesAction = uses.some((u) => /shellcheck/i.test(u));
  assert(
    invokesGate || usesAction,
    "shellcheck.yml must run `quality/shellcheck.sh`, invoke `shellcheck` " +
      "directly, or use a shellcheck action",
  );
});

Deno.test("shellcheck workflow runs on pull requests (#480)", async () => {
  const wf = await loadWorkflow(SHELLCHECK_WORKFLOW);
  assert(
    isPrTriggered(wf),
    "shellcheck.yml must trigger on pull_request so regressions fail the build",
  );
});

Deno.test("shellcheck workflow caps its job timeout (#480)", async () => {
  const wf = await loadWorkflow(SHELLCHECK_WORKFLOW);
  const jobs = Object.entries(wf.jobs ?? {});
  assert(jobs.length > 0, "shellcheck.yml must define at least one job");
  for (const [name, job] of jobs) {
    const timeout = job?.["timeout-minutes"];
    assert(
      typeof timeout === "number" && Number.isInteger(timeout) && timeout > 0 &&
        timeout <= 60,
      `shellcheck.yml job '${name}' must declare a positive timeout-minutes <= 60`,
    );
  }
});

Deno.test("shellcheck workflow declares a cancelling concurrency group (#480)", async () => {
  const wf = await loadWorkflow(SHELLCHECK_WORKFLOW);
  const conc = wf.concurrency;
  assert(
    conc && typeof conc === "object",
    "shellcheck.yml must declare a top-level concurrency block",
  );
  const group = (conc as ConcurrencyBlock).group ?? "";
  assert(
    group.includes("github.workflow") && group.includes("github.ref"),
    "concurrency.group must reference github.workflow and github.ref",
  );
  assertEquals(
    (conc as ConcurrencyBlock)["cancel-in-progress"],
    true,
    "shellcheck.yml concurrency must set cancel-in-progress: true",
  );
});
