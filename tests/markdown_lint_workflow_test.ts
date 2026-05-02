/**
 * Tests for the Markdown Lint workflow (#170).
 *
 * Validates that .github/workflows/markdown-lint.yml is present, parseable,
 * and configured to lint Markdown files on pull requests using
 * markdownlint-cli2 with third-party actions pinned to commit SHAs.
 */

import { parse as parseYaml } from "@std/yaml";
import { assert, assertEquals } from "./test_helpers.ts";

const WORKFLOW_PATH = new URL(
  "../.github/workflows/markdown-lint.yml",
  import.meta.url,
);
const CONFIG_PATH = new URL(
  "../.markdownlint-cli2.jsonc",
  import.meta.url,
);

interface WorkflowStep {
  uses?: string;
  name?: string;
  run?: string;
  with?: Record<string, unknown>;
  if?: string;
  id?: string;
}

interface MarkdownLintWorkflow {
  name?: string;
  on?: Record<string, unknown> | string;
  permissions?: Record<string, string>;
  jobs?: Record<string, {
    "runs-on"?: string;
    steps?: WorkflowStep[];
  }>;
}

async function loadWorkflow(): Promise<MarkdownLintWorkflow> {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  return parseYaml(text) as MarkdownLintWorkflow;
}

Deno.test("markdown-lint workflow file exists", async () => {
  const stat = await Deno.stat(WORKFLOW_PATH);
  assert(stat.isFile, "expected markdown-lint.yml to be a regular file");
});

Deno.test("markdown-lint workflow is valid YAML and named correctly", async () => {
  const wf = await loadWorkflow();
  assertEquals(wf.name, "Markdown Lint");
});

Deno.test("markdown-lint workflow triggers on pull_request and main pushes", async () => {
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
  assert(
    "push" in triggers,
    "workflow must trigger on push events for the default branch",
  );
});

Deno.test("markdown-lint workflow uses minimal contents:read permissions", async () => {
  const wf = await loadWorkflow();
  assertEquals(wf.permissions?.contents, "read");
});

Deno.test("markdown-lint workflow installs and runs markdownlint-cli2", async () => {
  const wf = await loadWorkflow();
  const job = wf.jobs?.markdownlint;
  assert(job, "expected a 'markdownlint' job");
  assertEquals(job!["runs-on"], "ubuntu-latest");

  const steps = job!.steps ?? [];
  const checkout = steps.find((s) =>
    (s.uses ?? "").startsWith("actions/checkout@")
  );
  assert(checkout, "workflow must check out the repository");

  const setupNode = steps.find((s) =>
    (s.uses ?? "").startsWith("actions/setup-node@")
  );
  assert(setupNode, "workflow must set up Node.js");

  const install = steps.find((s) =>
    (s.run ?? "").includes("markdownlint-cli2")
  );
  assert(install, "workflow must install or run markdownlint-cli2");

  const runStep = steps.find((s) =>
    (s.run ?? "").trim() === "markdownlint-cli2" ||
    (s.run ?? "").startsWith("markdownlint-cli2")
  );
  assert(runStep, "workflow must invoke markdownlint-cli2");
});

Deno.test("markdown-lint workflow pins third-party actions to commit SHAs", async () => {
  const wf = await loadWorkflow();
  const job = wf.jobs?.markdownlint;
  const steps = job?.steps ?? [];

  const thirdPartyUses = steps
    .map((s) => s.uses ?? "")
    .filter((u) => u.length > 0);

  for (const uses of thirdPartyUses) {
    const ref = uses.split("@")[1] ?? "";
    // Commit SHAs are 40 hex characters; tags/branches are not.
    assert(
      /^[0-9a-f]{40}$/.test(ref),
      `action ${uses} must be pinned to a 40-char commit SHA, got '${ref}'`,
    );
  }
});

Deno.test("markdownlint-cli2 config exists and is valid JSON", async () => {
  const text = await Deno.readTextFile(CONFIG_PATH);
  // Strip simple // line comments for JSONC parsing.
  const stripped = text.replace(/^\s*\/\/.*$/gm, "");
  const parsed = JSON.parse(stripped);
  assert(
    parsed && typeof parsed === "object",
    "markdownlint-cli2 config must be a JSON object",
  );
});
