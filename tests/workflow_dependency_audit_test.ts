/**
 * Tests for the standing dependency vulnerability scanner (#355).
 *
 * CI gates dependency *changes* on PRs through `dependency-review.yml`, but
 * that action only inspects the diff of an incoming change — it never
 * re-evaluates the standing dependency tree. A CVE disclosed against an
 * already-merged dependency is therefore invisible to CI until that
 * dependency happens to change again.
 *
 * `dependency-audit.yml` closes that gap: a Deno-native `deno audit` over the
 * resolved lockfile (`deno.lock`), run on a weekly schedule AND on every pull
 * request, so a freshly-published advisory against a pinned (possibly
 * transitive) dependency surfaces without waiting for the next bump.
 *
 * These tests assert the workflow exists and is wired to fail the build:
 * it runs `deno audit`, triggers on both `schedule` and `pull_request`,
 * sets up Deno, and obeys the repo-wide workflow policies (job timeout, PR
 * concurrency, least-privilege permissions). SHA-pinning and
 * checkout-consistency are enforced by their own dedicated tests across all
 * workflows, so they are not re-checked here.
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
  permissions?: Record<string, string> | string;
  jobs?: Record<string, WorkflowJob>;
}

const WORKFLOWS_DIR = new URL("../.github/workflows/", import.meta.url);
const AUDIT_WORKFLOW = "dependency-audit.yml";

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

/** All `uses:` references across every job in a workflow. */
function collectUses(wf: Workflow): string[] {
  const out: string[] = [];
  for (const job of Object.values(wf.jobs ?? {})) {
    for (const step of job?.steps ?? []) {
      if (typeof step.uses === "string") out.push(step.uses);
    }
  }
  return out;
}

function hasTrigger(wf: Workflow, event: string): boolean {
  const triggers = wf.on;
  if (!triggers) return false;
  if (typeof triggers === "string") return triggers === event;
  if (Array.isArray(triggers)) return triggers.includes(event);
  return event in (triggers as Record<string, unknown>);
}

Deno.test("dependency-audit workflow runs `deno audit` over the lockfile (#355)", async () => {
  const wf = await loadWorkflow(AUDIT_WORKFLOW);
  const scripts = collectRunScripts(wf);
  assert(
    scripts.some((s) => /\bdeno\s+audit\b/.test(s)),
    "dependency-audit.yml must contain a run step that invokes `deno audit`",
  );
});

Deno.test("dependency-audit workflow runs on a schedule (#355)", async () => {
  const wf = await loadWorkflow(AUDIT_WORKFLOW);
  assert(
    hasTrigger(wf, "schedule"),
    "dependency-audit.yml must declare a `schedule` trigger so the standing " +
      "dependency tree is re-scanned even when nothing changes",
  );
  const triggers = wf.on as Record<string, unknown>;
  const schedule = triggers.schedule as Array<{ cron?: string }> | undefined;
  assert(
    Array.isArray(schedule) && schedule.length > 0 &&
      typeof schedule[0]?.cron === "string" && schedule[0].cron.length > 0,
    "dependency-audit.yml schedule must declare at least one cron expression",
  );
});

Deno.test("dependency-audit workflow also runs on pull requests (#355)", async () => {
  const wf = await loadWorkflow(AUDIT_WORKFLOW);
  assert(
    hasTrigger(wf, "pull_request"),
    "dependency-audit.yml must trigger on pull_request so a newly-introduced " +
      "vulnerable dependency fails the build before merge",
  );
});

Deno.test("dependency-audit workflow sets up Deno (#355)", async () => {
  const wf = await loadWorkflow(AUDIT_WORKFLOW);
  const uses = collectUses(wf);
  assert(
    uses.some((u) => u.startsWith("denoland/setup-deno@")),
    "dependency-audit.yml must use denoland/setup-deno so `deno audit` is " +
      "available on the runner",
  );
});

Deno.test("dependency-audit workflow caps its job timeout (#355)", async () => {
  const wf = await loadWorkflow(AUDIT_WORKFLOW);
  const jobs = Object.entries(wf.jobs ?? {});
  assert(jobs.length > 0, "dependency-audit.yml must define at least one job");
  for (const [name, job] of jobs) {
    const timeout = job?.["timeout-minutes"];
    assert(
      typeof timeout === "number" && Number.isInteger(timeout) && timeout > 0 &&
        timeout <= 60,
      `dependency-audit.yml job '${name}' must declare a positive ` +
        `timeout-minutes <= 60`,
    );
  }
});

Deno.test("dependency-audit workflow declares a cancelling concurrency group (#355)", async () => {
  const wf = await loadWorkflow(AUDIT_WORKFLOW);
  const conc = wf.concurrency;
  assert(
    conc && typeof conc === "object",
    "dependency-audit.yml must declare a top-level concurrency block",
  );
  const group = (conc as ConcurrencyBlock).group ?? "";
  assert(
    group.includes("github.workflow") && group.includes("github.ref"),
    "concurrency.group must reference github.workflow and github.ref",
  );
  assert(
    (conc as ConcurrencyBlock)["cancel-in-progress"] === true,
    "dependency-audit.yml concurrency must set cancel-in-progress: true",
  );
});

Deno.test("dependency-audit workflow requests least-privilege permissions (#355)", async () => {
  const wf = await loadWorkflow(AUDIT_WORKFLOW);
  const perms = wf.permissions;
  assert(
    perms && typeof perms === "object",
    "dependency-audit.yml must declare a top-level permissions block",
  );
  const perimsObj = perms as Record<string, string>;
  assert(
    perimsObj.contents === "read",
    "dependency-audit.yml must request contents: read (no write scopes needed)",
  );
});
