/**
 * Tests for the Deno Quality workflow (#172).
 *
 * Validates that .github/workflows/deno-quality.yml exists, parses cleanly,
 * triggers on pull requests for any branch, runs `deno fmt --check`,
 * `deno lint`, `deno check`, and `deno test`, uploads coverage to Codecov,
 * and pins all third-party actions to commit SHAs.
 */

import { parse as parseYaml } from "@std/yaml";
import { assert, assertEquals } from "./test_helpers.ts";

const WORKFLOW_PATH = new URL(
  "../.github/workflows/deno-quality.yml",
  import.meta.url,
);

interface WorkflowStep {
  uses?: string;
  name?: string;
  run?: string;
  with?: Record<string, unknown>;
}

interface DenoQualityWorkflow {
  name?: string;
  on?: Record<string, unknown> | string;
  permissions?: Record<string, string>;
  jobs?: Record<string, {
    name?: string;
    "runs-on"?: string;
    steps?: WorkflowStep[];
  }>;
}

async function loadWorkflow(): Promise<DenoQualityWorkflow> {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  return parseYaml(text) as DenoQualityWorkflow;
}

function findRunStep(
  steps: WorkflowStep[],
  needle: string,
): WorkflowStep | undefined {
  return steps.find((s) =>
    typeof s.run === "string" && s.run!.includes(needle)
  );
}

Deno.test("deno-quality workflow file exists", async () => {
  const stat = await Deno.stat(WORKFLOW_PATH);
  assert(stat.isFile, "expected deno-quality.yml to be a regular file");
});

Deno.test("deno-quality workflow is valid YAML and named correctly", async () => {
  const wf = await loadWorkflow();
  assertEquals(wf.name, "Deno Quality");
});

Deno.test("deno-quality workflow triggers on pull_request for any branch", async () => {
  const wf = await loadWorkflow();
  const triggers = wf.on as Record<string, unknown> | undefined;
  assert(
    triggers && typeof triggers === "object",
    "workflow must declare triggers",
  );
  assert(
    "pull_request" in triggers,
    "workflow must trigger on pull_request events",
  );
});

Deno.test("deno-quality workflow uses minimal contents:read permissions", async () => {
  const wf = await loadWorkflow();
  assertEquals(wf.permissions?.contents, "read");
});

Deno.test("deno-quality workflow sets up Deno via denoland/setup-deno", async () => {
  const wf = await loadWorkflow();
  const job = wf.jobs?.quality;
  assert(job, "expected a 'quality' job");
  const steps = job?.steps ?? [];
  const setup = steps.find((s) =>
    (s.uses ?? "").startsWith("denoland/setup-deno@")
  );
  assert(setup, "workflow must use denoland/setup-deno");
});

Deno.test("deno-quality workflow runs deno fmt --check", async () => {
  const wf = await loadWorkflow();
  const job = wf.jobs?.quality;
  assert(job, "expected a 'quality' job");
  const steps = job!.steps ?? [];
  const fmt = findRunStep(steps, "deno fmt --check");
  assert(fmt, "workflow must run 'deno fmt --check'");
});

Deno.test("deno-quality workflow runs deno lint", async () => {
  const wf = await loadWorkflow();
  const job = wf.jobs?.quality;
  assert(job, "expected a 'quality' job");
  const steps = job!.steps ?? [];
  const lint = findRunStep(steps, "deno lint");
  assert(lint, "workflow must run 'deno lint'");
});

Deno.test("deno-quality workflow runs deno check for type checking", async () => {
  const wf = await loadWorkflow();
  const job = wf.jobs?.quality;
  assert(job, "expected a 'quality' job");
  const steps = job!.steps ?? [];
  const check = findRunStep(steps, "deno check");
  assert(check, "workflow must run 'deno check'");
});

// Issue #210 — the deno check step must cover the whole repo, not just the
// old `helpers/ scripts/ tests/` allowlist, so type errors under docs/ are
// caught in CI.
Deno.test("deno-quality workflow's deno check covers docs/ (Issue #210)", async () => {
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

Deno.test("deno-quality workflow runs deno test with coverage", async () => {
  const wf = await loadWorkflow();
  const job = wf.jobs?.quality;
  assert(job, "expected a 'quality' job");
  const steps = job!.steps ?? [];
  const test = findRunStep(steps, "deno test");
  assert(test, "workflow must run 'deno test'");
  assert(
    test!.run!.includes("--coverage"),
    "deno test must capture coverage data",
  );
});

Deno.test("deno-quality workflow generates lcov coverage and uploads to Codecov", async () => {
  const wf = await loadWorkflow();
  const job = wf.jobs?.quality;
  const steps = job?.steps ?? [];

  const lcov = findRunStep(steps, "deno coverage");
  assert(lcov, "workflow must convert coverage data to lcov format");
  assert(
    lcov!.run!.includes("--lcov"),
    "deno coverage must emit lcov output",
  );

  const codecov = steps.find((s) =>
    (s.uses ?? "").startsWith("codecov/codecov-action@")
  );
  assert(codecov, "workflow must upload coverage via codecov-action");
});

// Issue #259 — after consolidating ci.yml into deno-quality.yml, the job
// must keep the display name "Quality Gate" so any required-status-check
// rule referencing that label continues to resolve.
Deno.test("deno-quality 'quality' job is named 'Quality Gate' (Issue #259)", async () => {
  const wf = await loadWorkflow();
  const job = wf.jobs?.quality;
  assert(job, "expected a 'quality' job");
  assertEquals(job!.name, "Quality Gate");
});

// Issue #259 — the duplicate ci.yml workflow must stay removed. Both
// workflows ran the same four checks on every Develop PR; deno-quality.yml
// is the superset (it adds coverage + Codecov), so ci.yml was deleted.
Deno.test("legacy ci.yml workflow has been removed (Issue #259)", async () => {
  const ciYmlPath = new URL(
    "../.github/workflows/ci.yml",
    import.meta.url,
  );
  let exists = false;
  try {
    await Deno.stat(ciYmlPath);
    exists = true;
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
  assert(
    !exists,
    "ci.yml must remain deleted — its checks are now covered by deno-quality.yml",
  );
});

Deno.test("deno-quality workflow pins third-party actions to commit SHAs", async () => {
  const wf = await loadWorkflow();
  const job = wf.jobs?.quality;
  const steps = job?.steps ?? [];

  const thirdPartyUses = steps
    .map((s) => s.uses ?? "")
    .filter((u) => u.length > 0);

  assert(thirdPartyUses.length > 0, "expected at least one 'uses:' step");

  for (const uses of thirdPartyUses) {
    const ref = uses.split("@")[1] ?? "";
    assert(
      /^[0-9a-f]{40}$/.test(ref),
      `action ${uses} must be pinned to a 40-char commit SHA, got '${ref}'`,
    );
  }
});
