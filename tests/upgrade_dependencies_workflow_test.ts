/**
 * Tests for the Upgrade Deno Dependencies workflow (#158).
 *
 * Validates that .github/workflows/upgrade-dependencies.yml mirrors the
 * NEAT-AI-core upgrade-dependencies pattern, adapted for Deno: weekly
 * schedule, dry-run capture, change detection, summary body, and a PR
 * raised against Develop via peter-evans/create-pull-request.
 */

import { parse as parseYaml } from "@std/yaml";
import { assert, assertEquals } from "./test_helpers.ts";

const WORKFLOW_PATH = new URL(
  "../.github/workflows/upgrade-dependencies.yml",
  import.meta.url,
);

interface WorkflowStep {
  name?: string;
  id?: string;
  if?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
}

interface UpgradeWorkflow {
  name?: string;
  on?: Record<string, unknown> | string;
  permissions?: Record<string, string>;
  jobs?: Record<string, {
    "runs-on"?: string;
    steps?: WorkflowStep[];
  }>;
}

async function loadWorkflow(): Promise<UpgradeWorkflow> {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  return parseYaml(text) as UpgradeWorkflow;
}

Deno.test("upgrade-dependencies workflow file exists", async () => {
  const stat = await Deno.stat(WORKFLOW_PATH);
  assert(stat.isFile, "expected upgrade-dependencies.yml to be a regular file");
});

Deno.test("upgrade-dependencies workflow is valid YAML and named correctly", async () => {
  const wf = await loadWorkflow();
  assert(
    typeof wf.name === "string" && wf.name.length > 0,
    "workflow must have a name",
  );
  assert(
    /upgrade.*deno.*dependencies/i.test(wf.name!),
    `workflow name should mention upgrading Deno dependencies, got '${wf.name}'`,
  );
});

Deno.test("upgrade-dependencies workflow runs weekly on Monday 06:00 UTC and on demand", async () => {
  const wf = await loadWorkflow();
  const triggers = wf.on as Record<string, unknown> | undefined;
  assert(
    triggers && typeof triggers === "object",
    "workflow must declare triggers",
  );
  assert("schedule" in triggers, "workflow must declare a schedule trigger");
  assert(
    "workflow_dispatch" in triggers,
    "workflow must support manual workflow_dispatch",
  );
  const schedule = triggers.schedule as Array<{ cron?: string }>;
  assert(
    Array.isArray(schedule) && schedule.length > 0,
    "schedule entry expected",
  );
  assertEquals(
    schedule[0].cron,
    "0 6 * * 1",
    "cron should be weekly Mon 06:00 UTC",
  );
});

Deno.test("upgrade-dependencies workflow grants write permissions for PR creation", async () => {
  const wf = await loadWorkflow();
  assertEquals(wf.permissions?.contents, "write");
  assertEquals(wf.permissions?.["pull-requests"], "write");
});

Deno.test("upgrade-dependencies workflow checks out Develop and sets up Deno v2", async () => {
  const wf = await loadWorkflow();
  const job = Object.values(wf.jobs ?? {})[0];
  assert(job, "expected at least one job");
  assertEquals(job["runs-on"], "ubuntu-latest");

  const steps = job.steps ?? [];
  const checkout = steps.find((s) =>
    (s.uses ?? "").startsWith("actions/checkout@")
  );
  assert(checkout, "workflow must check out the repository");
  assertEquals(
    checkout!.with?.ref,
    "Develop",
    "checkout must target the Develop branch",
  );

  const setupDeno = steps.find((s) =>
    (s.uses ?? "").startsWith("denoland/setup-deno@")
  );
  assert(setupDeno, "workflow must set up Deno");
  const denoVersion = String(setupDeno!.with?.["deno-version"] ?? "");
  assert(
    denoVersion.startsWith("v2"),
    `deno-version should pin to v2.x, got '${denoVersion}'`,
  );
});

Deno.test("upgrade-dependencies workflow runs deno outdated --update --latest with tee capture", async () => {
  const wf = await loadWorkflow();
  const job = Object.values(wf.jobs ?? {})[0];
  const steps = job!.steps ?? [];
  const upgrade = steps.find((s) =>
    typeof s.run === "string" && s.run.includes("deno outdated")
  );
  assert(upgrade, "workflow must run `deno outdated`");
  const run = upgrade!.run ?? "";
  assert(run.includes("--update"), "deno outdated must use --update");
  assert(run.includes("--latest"), "deno outdated must use --latest");
  assert(
    run.includes("tee") && run.includes("upgrade"),
    "workflow must tee deno outdated output for the PR body",
  );
});

Deno.test("upgrade-dependencies workflow detects changes via git diff and sets a 'changed' output", async () => {
  const wf = await loadWorkflow();
  const job = Object.values(wf.jobs ?? {})[0];
  const steps = job!.steps ?? [];
  const detect = steps.find((s) =>
    typeof s.run === "string" &&
    s.run.includes("git diff") &&
    s.run.includes("changed=")
  );
  assert(detect, "workflow must detect Deno dependency changes via git diff");
  const run = detect!.run ?? "";
  assert(run.includes("deno.json"), "change detection must inspect deno.json");
  assert(run.includes("deno.lock"), "change detection must inspect deno.lock");
  assert(run.includes("changed=true") && run.includes("changed=false"));
  assertEquals(
    detect!.id,
    "changes",
    "step id should be 'changes' for outputs.changed",
  );
});

Deno.test("upgrade-dependencies workflow builds a markdown summary embedding the dry-run log", async () => {
  const wf = await loadWorkflow();
  const job = Object.values(wf.jobs ?? {})[0];
  const steps = job!.steps ?? [];
  const summary = steps.find((s) => s.id === "summary");
  assert(summary, "workflow must build a PR body summary step (id=summary)");
  assertEquals(
    summary!.if,
    "steps.changes.outputs.changed == 'true'",
    "summary step must be gated on changes",
  );
  const run = summary!.run ?? "";
  assert(
    run.includes("body<<EOF"),
    "summary must emit a multi-line 'body' output",
  );
  assert(
    run.includes("```"),
    "summary must wrap the dry-run log in a fenced code block",
  );
  assert(
    run.includes("upgrade-dry-run.txt"),
    "summary must embed the captured dry-run log",
  );
});

Deno.test("upgrade-dependencies workflow opens a PR via peter-evans/create-pull-request@v7", async () => {
  const wf = await loadWorkflow();
  const job = Object.values(wf.jobs ?? {})[0];
  const steps = job!.steps ?? [];
  const createPr = steps.find((s) =>
    (s.uses ?? "").startsWith("peter-evans/create-pull-request@")
  );
  assert(createPr, "workflow must open a pull request with the updates");
  assert(
    (createPr!.uses ?? "").includes("v7"),
    "must use peter-evans/create-pull-request@v7",
  );
  assertEquals(
    createPr!.if,
    "steps.changes.outputs.changed == 'true'",
    "PR creation must be gated on detected changes",
  );

  const w = createPr!.with ?? {};
  assertEquals(w.branch, "chore/upgrade-dependencies");
  assertEquals(w.base, "Develop");
  assertEquals(
    w.title,
    "chore: upgrade Deno dependencies to latest compatible versions",
  );
  assertEquals(
    w["commit-message"],
    "chore: upgrade deno.json dependencies to latest compatible versions",
  );
  assertEquals(w["delete-branch"], true);
  assertEquals(
    w.committer,
    "github-actions[bot] <github-actions[bot]@users.noreply.github.com>",
  );
  assertEquals(
    w.author,
    "github-actions[bot] <github-actions[bot]@users.noreply.github.com>",
  );
  const body = String(w.body ?? "");
  assert(
    body.includes("steps.summary.outputs.body"),
    "PR body must reference the summary step output",
  );
});
