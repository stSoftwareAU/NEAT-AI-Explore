/**
 * Tests for the Dependency Review workflow (#154).
 *
 * Validates that .github/workflows/dependency-review.yml is present, parseable,
 * and configured to scan pull requests with the minimal contents:read
 * permission set.
 */

import { parse as parseYaml } from "@std/yaml";
import { assert, assertEquals } from "./test_helpers.ts";

const WORKFLOW_PATH = new URL(
  "../.github/workflows/dependency-review.yml",
  import.meta.url,
);

interface DependencyReviewWorkflow {
  name?: string;
  on?: Record<string, unknown> | string;
  permissions?: Record<string, string>;
  jobs?: Record<string, {
    "runs-on"?: string;
    steps?: Array<{ uses?: string; with?: Record<string, unknown> }>;
  }>;
}

async function loadWorkflow(): Promise<DependencyReviewWorkflow> {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  return parseYaml(text) as DependencyReviewWorkflow;
}

Deno.test("dependency-review workflow file exists", async () => {
  const stat = await Deno.stat(WORKFLOW_PATH);
  assert(stat.isFile, "expected dependency-review.yml to be a regular file");
});

Deno.test("dependency-review workflow is valid YAML and named correctly", async () => {
  const wf = await loadWorkflow();
  assertEquals(wf.name, "Dependency Review");
});

Deno.test("dependency-review workflow triggers on pull_request", async () => {
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

Deno.test("dependency-review workflow uses minimal contents:read permissions", async () => {
  const wf = await loadWorkflow();
  assertEquals(wf.permissions?.contents, "read");
});

Deno.test("dependency-review workflow runs dependency-review-action after checkout", async () => {
  const wf = await loadWorkflow();
  const job = wf.jobs?.["dependency-review"];
  assert(job, "expected a 'dependency-review' job");
  assertEquals(job!["runs-on"], "ubuntu-latest");

  const steps = job!.steps ?? [];
  const checkout = steps.find((s) =>
    (s.uses ?? "").startsWith("actions/checkout@")
  );
  assert(checkout, "workflow must check out the repository");

  const review = steps.find((s) =>
    (s.uses ?? "").startsWith("actions/dependency-review-action@")
  );
  assert(review, "workflow must run the actions/dependency-review-action step");
});
