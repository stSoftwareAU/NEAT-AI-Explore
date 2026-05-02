/**
 * Tests for the Gitleaks Secrets Detection workflow (#152).
 *
 * Validates that .github/workflows/gitleaks.yml is present, parseable, and
 * configured to scan pull requests with the required permissions and full
 * git history.
 */

import { parse as parseYaml } from "@std/yaml";
import { assert, assertEquals } from "./test_helpers.ts";

const WORKFLOW_PATH = new URL(
  "../.github/workflows/gitleaks.yml",
  import.meta.url,
);

interface GitleaksWorkflow {
  name?: string;
  on?: Record<string, unknown> | string;
  permissions?: Record<string, string>;
  jobs?: Record<string, {
    "runs-on"?: string;
    steps?: Array<{
      name?: string;
      uses?: string;
      run?: string;
      if?: string;
      with?: Record<string, unknown>;
    }>;
  }>;
}

async function loadWorkflow(): Promise<GitleaksWorkflow> {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  return parseYaml(text) as GitleaksWorkflow;
}

Deno.test("gitleaks workflow file exists", async () => {
  const stat = await Deno.stat(WORKFLOW_PATH);
  assert(stat.isFile, "expected gitleaks.yml to be a regular file");
});

Deno.test("gitleaks workflow is valid YAML and named correctly", async () => {
  const wf = await loadWorkflow();
  assertEquals(wf.name, "Gitleaks");
});

Deno.test("gitleaks workflow triggers on pull_request", async () => {
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

Deno.test("gitleaks workflow uses minimal contents:read permissions", async () => {
  const wf = await loadWorkflow();
  assertEquals(wf.permissions?.contents, "read");
});

Deno.test("gitleaks workflow runs gitleaks-action with full history", async () => {
  const wf = await loadWorkflow();
  const job = wf.jobs?.gitleaks;
  assert(job, "expected a 'gitleaks' job");
  assertEquals(job!["runs-on"], "ubuntu-latest");

  const steps = job!.steps ?? [];
  const checkout = steps.find((s) =>
    (s.uses ?? "").startsWith("actions/checkout@")
  );
  assert(checkout, "workflow must check out the repository");
  assertEquals(
    checkout!.with?.["fetch-depth"],
    0,
    "checkout must use fetch-depth: 0 so gitleaks can scan full history",
  );

  const gitleaks = steps.find((s) =>
    (s.uses ?? "").startsWith("gitleaks/gitleaks-action@")
  );
  assert(gitleaks, "workflow must run the gitleaks/gitleaks-action step");
});

Deno.test("gitleaks workflow pins third-party actions to commit SHAs", async () => {
  const wf = await loadWorkflow();
  const steps = wf.jobs?.gitleaks?.steps ?? [];
  const sha40 = /@[0-9a-f]{40}$/;
  for (const step of steps) {
    if (!step.uses) continue;
    assert(
      sha40.test(step.uses),
      `step '${step.uses}' must be pinned to a 40-character commit SHA ` +
        `(Issue #1756) — version tags are mutable and a hijacked tag can ` +
        `exfiltrate CI secrets`,
    );
  }
});

Deno.test("gitleaks workflow fetches PR base branch before scanning", async () => {
  const wf = await loadWorkflow();
  const steps = wf.jobs?.gitleaks?.steps ?? [];

  const fetchStep = steps.find((s) =>
    typeof s.run === "string" && s.run.includes("git fetch origin")
  );
  assert(
    fetchStep,
    "workflow must fetch the PR base branch so gitleaks-action's commit " +
      "range resolves on the runner (mirrors NEAT-AI quality.yml pattern)",
  );
  assert(
    typeof fetchStep!.if === "string" &&
      fetchStep!.if.includes("pull_request"),
    "fetch-base-branch step must be guarded by a pull_request event check",
  );

  // Order matters: the fetch must run after checkout but before gitleaks.
  const indexOf = (
    predicate: (s: { uses?: string; run?: string }) => boolean,
  ) => steps.findIndex(predicate);
  const checkoutIdx = indexOf((s) =>
    (s.uses ?? "").startsWith("actions/checkout@")
  );
  const fetchIdx = indexOf((s) =>
    typeof s.run === "string" && s.run.includes("git fetch origin")
  );
  const gitleaksIdx = indexOf((s) =>
    (s.uses ?? "").startsWith("gitleaks/gitleaks-action@")
  );
  assert(
    checkoutIdx < fetchIdx && fetchIdx < gitleaksIdx,
    "fetch step must run after checkout and before gitleaks-action",
  );
});
