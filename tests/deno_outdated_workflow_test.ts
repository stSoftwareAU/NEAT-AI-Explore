/**
 * Tests for the Deno Dependency Updates workflow (#155).
 *
 * Validates that .github/workflows/deno-outdated.yml is present, parseable,
 * and configured to run `deno outdated --update --latest` on a weekly
 * schedule and open a pull request with the changes.
 */

import { parse as parseYaml } from "@std/yaml";
import { assert, assertEquals } from "./test_helpers.ts";

const WORKFLOW_PATH = new URL(
  "../.github/workflows/deno-outdated.yml",
  import.meta.url,
);

interface WorkflowStep {
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
}

interface OutdatedWorkflow {
  name?: string;
  on?: Record<string, unknown> | string;
  permissions?: Record<string, string>;
  jobs?: Record<string, {
    "runs-on"?: string;
    steps?: WorkflowStep[];
  }>;
}

async function loadWorkflow(): Promise<OutdatedWorkflow> {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  return parseYaml(text) as OutdatedWorkflow;
}

Deno.test("deno-outdated workflow file exists", async () => {
  const stat = await Deno.stat(WORKFLOW_PATH);
  assert(stat.isFile, "expected deno-outdated.yml to be a regular file");
});

Deno.test("deno-outdated workflow is valid YAML and named correctly", async () => {
  const wf = await loadWorkflow();
  assertEquals(wf.name, "Deno Dependency Updates");
});

Deno.test("deno-outdated workflow runs on a weekly schedule and on demand", async () => {
  const wf = await loadWorkflow();
  const triggers = wf.on as Record<string, unknown> | undefined;
  assert(
    triggers && typeof triggers === "object",
    "workflow must declare triggers",
  );
  assert(
    "schedule" in triggers,
    "workflow must declare a schedule trigger",
  );
  assert(
    "workflow_dispatch" in triggers,
    "workflow must support manual workflow_dispatch",
  );
  const schedule = triggers.schedule as Array<{ cron?: string }>;
  assert(
    Array.isArray(schedule) && schedule.length > 0,
    "schedule entry expected",
  );
  assert(
    typeof schedule[0].cron === "string" && schedule[0].cron.length > 0,
    "schedule must specify a cron expression",
  );
});

Deno.test("deno-outdated workflow grants write permissions for PR creation", async () => {
  const wf = await loadWorkflow();
  assertEquals(wf.permissions?.contents, "write");
  assertEquals(wf.permissions?.["pull-requests"], "write");
});

Deno.test("deno-outdated workflow checks out, sets up Deno, runs deno outdated, and opens a PR", async () => {
  const wf = await loadWorkflow();
  const job = wf.jobs?.outdated;
  assert(job, "expected an 'outdated' job");
  assertEquals(job!["runs-on"], "ubuntu-latest");

  const steps = job!.steps ?? [];
  const checkout = steps.find((s) =>
    (s.uses ?? "").startsWith("actions/checkout@")
  );
  assert(checkout, "workflow must check out the repository");

  const setupDeno = steps.find((s) =>
    (s.uses ?? "").startsWith("denoland/setup-deno@")
  );
  assert(setupDeno, "workflow must set up Deno");

  const outdated = steps.find((s) =>
    typeof s.run === "string" && s.run.includes("deno outdated")
  );
  assert(outdated, "workflow must run `deno outdated`");
  assert(
    (outdated!.run ?? "").includes("--update"),
    "deno outdated must use --update to apply updates",
  );
  assert(
    (outdated!.run ?? "").includes("--latest"),
    "deno outdated must use --latest to pull the newest versions",
  );

  const createPr = steps.find((s) =>
    (s.uses ?? "").startsWith("peter-evans/create-pull-request@")
  );
  assert(createPr, "workflow must open a pull request with the updates");
  const branch = createPr!.with?.branch;
  assert(
    typeof branch === "string" && branch.length > 0,
    "create-pull-request step must specify a branch",
  );
});
