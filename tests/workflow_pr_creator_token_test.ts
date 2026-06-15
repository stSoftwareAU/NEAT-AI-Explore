/**
 * Tests for the `create-pull-request` token wiring (#344).
 *
 * `peter-evans/create-pull-request` must authenticate with the org-level
 * PAT (`ACTIONS_PUSH`) and fall back to `GITHUB_TOKEN` only when that
 * secret is unset (#1636). Using `GITHUB_TOKEN` directly causes GitHub to
 * suppress downstream workflow triggers on the created pull request — CI
 * checks, labels, and reviewer automation never fire until somebody pushes
 * a new commit.
 */

import { parse as parseYaml } from "@std/yaml";
import { assert, assertEquals } from "./test_helpers.ts";

interface WorkflowStep {
  uses?: string;
  with?: Record<string, unknown>;
}

interface WorkflowJob {
  steps?: WorkflowStep[];
}

interface Workflow {
  jobs?: Record<string, WorkflowJob>;
}

const WORKFLOWS_DIR = new URL("../.github/workflows/", import.meta.url);

async function listWorkflowFiles(): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(WORKFLOWS_DIR)) {
    if (!entry.isFile) continue;
    if (!entry.name.endsWith(".yml") && !entry.name.endsWith(".yaml")) continue;
    files.push(entry.name);
  }
  files.sort();
  return files;
}

async function loadWorkflow(name: string): Promise<Workflow> {
  const url = new URL(name, WORKFLOWS_DIR);
  const text = await Deno.readTextFile(url);
  return parseYaml(text) as Workflow;
}

/** Collect `[file, token]` for every `peter-evans/create-pull-request` step. */
async function collectCreatePrTokens(): Promise<Array<[string, string]>> {
  const tokens: Array<[string, string]> = [];
  for (const file of await listWorkflowFiles()) {
    const wf = await loadWorkflow(file);
    for (const job of Object.values(wf.jobs ?? {})) {
      for (const step of job?.steps ?? []) {
        const uses = step.uses;
        if (
          typeof uses === "string" &&
          uses.startsWith("peter-evans/create-pull-request@")
        ) {
          tokens.push([file, String(step.with?.token ?? "")]);
        }
      }
    }
  }
  return tokens;
}

Deno.test("create-pull-request step exists (#344)", async () => {
  const tokens = await collectCreatePrTokens();
  assert(
    tokens.length > 0,
    "expected at least one peter-evans/create-pull-request reference",
  );
});

Deno.test(
  "create-pull-request prefers ACTIONS_PUSH, falls back to GITHUB_TOKEN (#344)",
  async () => {
    const tokens = await collectCreatePrTokens();
    for (const [file, token] of tokens) {
      const normalised = token.replace(/\s+/g, " ").trim();
      assertEquals(
        normalised,
        "${{ secrets.ACTIONS_PUSH || secrets.GITHUB_TOKEN }}",
        `${file}: create-pull-request token must prefer the org PAT and ` +
          `fall back to GITHUB_TOKEN (#1636); found "${token}"`,
      );
    }
  },
);
