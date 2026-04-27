/**
 * Tests for the ShellCheck Lint workflow (#156).
 *
 * Validates that .github/workflows/shellcheck.yml is present, parseable, and
 * configured to lint shell scripts on pull requests with the expected
 * permissions and action invocation.
 */

import { parse as parseYaml } from "@std/yaml";
import { assert, assertEquals } from "./test_helpers.ts";

const WORKFLOW_PATH = new URL(
  "../.github/workflows/shellcheck.yml",
  import.meta.url,
);

interface ShellCheckWorkflow {
  name?: string;
  on?: Record<string, unknown> | string;
  permissions?: Record<string, string>;
  jobs?: Record<string, {
    "runs-on"?: string;
    steps?: Array<
      { uses?: string; name?: string; with?: Record<string, unknown> }
    >;
  }>;
}

async function loadWorkflow(): Promise<ShellCheckWorkflow> {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  return parseYaml(text) as ShellCheckWorkflow;
}

Deno.test("shellcheck workflow file exists", async () => {
  const stat = await Deno.stat(WORKFLOW_PATH);
  assert(stat.isFile, "expected shellcheck.yml to be a regular file");
});

Deno.test("shellcheck workflow is valid YAML and named correctly", async () => {
  const wf = await loadWorkflow();
  assertEquals(wf.name, "ShellCheck");
});

Deno.test("shellcheck workflow triggers on pull_request", async () => {
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

Deno.test("shellcheck workflow uses minimal contents:read permissions", async () => {
  const wf = await loadWorkflow();
  assertEquals(wf.permissions?.contents, "read");
});

Deno.test("shellcheck workflow runs action-shellcheck at warning severity", async () => {
  const wf = await loadWorkflow();
  const job = wf.jobs?.shellcheck;
  assert(job, "expected a 'shellcheck' job");
  assertEquals(job!["runs-on"], "ubuntu-latest");

  const steps = job!.steps ?? [];
  const checkout = steps.find((s) =>
    (s.uses ?? "").startsWith("actions/checkout@")
  );
  assert(checkout, "workflow must check out the repository");

  const shellcheck = steps.find((s) =>
    (s.uses ?? "").startsWith("ludeeus/action-shellcheck@")
  );
  assert(shellcheck, "workflow must run the ludeeus/action-shellcheck step");
  assertEquals(
    shellcheck!.with?.severity,
    "warning",
    "shellcheck must run at severity: warning",
  );
  assertEquals(
    shellcheck!.with?.scandir,
    ".",
    "shellcheck must scan the repository root",
  );
});

Deno.test("shellcheck workflow does not pin third-party action to a moving ref", async () => {
  const wf = await loadWorkflow();
  const job = wf.jobs?.shellcheck;
  const steps = job?.steps ?? [];
  const shellcheck = steps.find((s) =>
    (s.uses ?? "").startsWith("ludeeus/action-shellcheck@")
  );
  assert(shellcheck, "workflow must run the ludeeus/action-shellcheck step");
  const ref = (shellcheck!.uses ?? "").split("@")[1] ?? "";
  assert(
    ref !== "master" && ref !== "main",
    `third-party action must be pinned to a tag or commit SHA, not ${ref}`,
  );
});
