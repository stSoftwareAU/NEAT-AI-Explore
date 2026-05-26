/**
 * Tests for the Semgrep SAST Scanning workflow (#153).
 *
 * Validates that .github/workflows/semgrep.yml is present, parseable, and
 * configured to scan pull requests inside the semgrep container with the
 * required permissions.
 */

import { parse as parseYaml } from "@std/yaml";
import { assert, assertEquals } from "./test_helpers.ts";

const WORKFLOW_PATH = new URL(
  "../.github/workflows/semgrep.yml",
  import.meta.url,
);

interface SemgrepWorkflow {
  name?: string;
  on?: Record<string, unknown> | string;
  permissions?: Record<string, string>;
  jobs?: Record<string, {
    "runs-on"?: string;
    container?: string | { image?: string };
    steps?: Array<{
      uses?: string;
      run?: string;
      env?: Record<string, string>;
    }>;
  }>;
}

async function loadWorkflow(): Promise<SemgrepWorkflow> {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  return parseYaml(text) as SemgrepWorkflow;
}

Deno.test("semgrep workflow file exists", async () => {
  const stat = await Deno.stat(WORKFLOW_PATH);
  assert(stat.isFile, "expected semgrep.yml to be a regular file");
});

Deno.test("semgrep workflow is valid YAML and named correctly", async () => {
  const wf = await loadWorkflow();
  assertEquals(wf.name, "Semgrep");
});

Deno.test("semgrep workflow triggers on pull_request", async () => {
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

Deno.test("semgrep workflow uses minimal contents:read permissions", async () => {
  const wf = await loadWorkflow();
  assertEquals(wf.permissions?.contents, "read");
});

Deno.test("semgrep workflow runs in the semgrep container", async () => {
  const wf = await loadWorkflow();
  const job = wf.jobs?.semgrep;
  assert(job, "expected a 'semgrep' job");
  assertEquals(job!["runs-on"], "ubuntu-latest");

  const container = job!.container;
  const image = typeof container === "string" ? container : container?.image;
  assert(
    typeof image === "string" && image.startsWith("semgrep/semgrep"),
    "job must run inside the semgrep/semgrep container image",
  );
});

Deno.test("semgrep container image is pinned to a sha256 digest (#256)", async () => {
  // An unpinned `image: semgrep/semgrep` resolves to whatever the maintainers
  // (or anyone who hijacks the Docker Hub account) last pushed at runtime,
  // exposing SEMGREP_APP_TOKEN to malicious code. Pin to an immutable
  // multi-arch manifest digest so the resolved image is locked in.
  const wf = await loadWorkflow();
  const job = wf.jobs?.semgrep;
  assert(job, "expected a 'semgrep' job");

  const container = job!.container;
  const image = typeof container === "string" ? container : container?.image;
  assert(typeof image === "string", "container.image must be a string");

  const match = image!.match(/^semgrep\/semgrep@sha256:([0-9a-f]{64})$/);
  assert(
    match !== null,
    `container.image must be pinned as 'semgrep/semgrep@sha256:<64-hex>' ` +
      `but got '${image}'`,
  );
});

Deno.test("semgrep workflow checks out and runs semgrep ci", async () => {
  const wf = await loadWorkflow();
  const job = wf.jobs?.semgrep;
  assert(job, "expected a 'semgrep' job");

  const steps = job!.steps ?? [];
  const checkout = steps.find((s) =>
    (s.uses ?? "").startsWith("actions/checkout@")
  );
  assert(checkout, "workflow must check out the repository");

  const scan = steps.find((s) => (s.run ?? "").includes("semgrep ci"));
  assert(scan, "workflow must run a 'semgrep ci' step");
  assert(
    (scan!.run ?? "").includes("--config"),
    "semgrep ci step must specify a --config ruleset",
  );
  assertEquals(
    scan!.env?.SEMGREP_APP_TOKEN,
    "${{ secrets.SEMGREP_APP_TOKEN }}",
    "semgrep ci must receive SEMGREP_APP_TOKEN from repository secrets",
  );
});
