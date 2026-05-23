/**
 * Tests for the Quality Gate CI workflow (#157).
 *
 * Validates that .github/workflows/ci.yml includes Deno lint, format and type
 * checking — completing the Deno Lint and Format workflow capabilities flagged
 * by the VibeCoding workflow auditor.
 */

import { parse as parseYaml } from "@std/yaml";
import { assert, assertEquals } from "./test_helpers.ts";

const WORKFLOW_PATH = new URL(
  "../.github/workflows/ci.yml",
  import.meta.url,
);

interface CiStep {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
}

interface CiWorkflow {
  name?: string;
  on?: Record<string, unknown> | string;
  permissions?: Record<string, string>;
  jobs?: Record<string, {
    "runs-on"?: string;
    steps?: CiStep[];
  }>;
}

async function loadWorkflow(): Promise<CiWorkflow> {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  return parseYaml(text) as CiWorkflow;
}

function findRunStep(steps: CiStep[], needle: string): CiStep | undefined {
  return steps.find((s) =>
    typeof s.run === "string" && s.run!.includes(needle)
  );
}

Deno.test("ci workflow file exists", async () => {
  const stat = await Deno.stat(WORKFLOW_PATH);
  assert(stat.isFile, "expected ci.yml to be a regular file");
});

Deno.test("ci workflow is valid YAML and named Quality Gate", async () => {
  const wf = await loadWorkflow();
  assertEquals(wf.name, "Quality Gate");
});

Deno.test("ci workflow uses minimal contents:read permissions", async () => {
  const wf = await loadWorkflow();
  assertEquals(wf.permissions?.contents, "read");
});

Deno.test("ci workflow runs deno fmt --check", async () => {
  const wf = await loadWorkflow();
  const job = wf.jobs?.quality;
  assert(job, "expected a 'quality' job");
  const steps = job!.steps ?? [];
  const fmt = findRunStep(steps, "deno fmt --check");
  assert(fmt, "workflow must run 'deno fmt --check'");
});

Deno.test("ci workflow runs deno lint", async () => {
  const wf = await loadWorkflow();
  const job = wf.jobs?.quality;
  assert(job, "expected a 'quality' job");
  const steps = job!.steps ?? [];
  const lint = findRunStep(steps, "deno lint");
  assert(lint, "workflow must run 'deno lint'");
});

Deno.test("ci workflow runs deno check for type checking", async () => {
  const wf = await loadWorkflow();
  const job = wf.jobs?.quality;
  assert(job, "expected a 'quality' job");
  const steps = job!.steps ?? [];
  const check = findRunStep(steps, "deno check");
  assert(
    check,
    "workflow must run 'deno check' to type-check TypeScript sources",
  );
});

// Issue #210 — the ci workflow's deno check must cover docs/ so type errors
// under the published PWA are surfaced in CI, matching quality.sh.
Deno.test("ci workflow's deno check covers docs/ (Issue #210)", async () => {
  const wf = await loadWorkflow();
  const job = wf.jobs?.quality;
  assert(job, "expected a 'quality' job");
  const steps = job!.steps ?? [];
  const check = findRunStep(steps, "deno check");
  assert(check, "workflow must run 'deno check'");
  const run = check!.run!;
  assert(
    run.includes("docs/"),
    `'deno check' step must cover docs/, got: ${run}`,
  );
  assert(
    !/deno check\s+helpers\/\s+scripts\/\s+tests\/\s*$/m.test(run),
    `'deno check' step must not be restricted to helpers/ scripts/ tests/, got: ${run}`,
  );
});

Deno.test("ci workflow sets up Deno via denoland/setup-deno", async () => {
  const wf = await loadWorkflow();
  const job = wf.jobs?.quality;
  const steps = job?.steps ?? [];
  const setup = steps.find((s) =>
    (s.uses ?? "").startsWith("denoland/setup-deno@")
  );
  assert(setup, "workflow must use denoland/setup-deno");
});
