/**
 * Tests for the workflow action SHA pinning policy (#190).
 *
 * Every `uses:` reference in `.github/workflows/*.yml` must be pinned to a
 * 40-character commit SHA. Mutable tag references (e.g. `@v4`, `@v7`,
 * `@v4.1.1`) can be retagged by a compromised maintainer to point at a
 * malicious commit — the canonical supply-chain attack vector for GitHub
 * Actions. Pinning to a SHA forecloses that path.
 *
 * This file deliberately consolidates the SHA-pin check into a single
 * parser-walk across every workflow (Issue #263). Per-workflow grep-style
 * substring assertions on `run:` blocks are gone; the workflow either runs
 * in CI with a pinned action or it doesn't, and one parser-walk catches the
 * whole class.
 */

import { parse as parseYaml } from "@std/yaml";
import { assert } from "./test_helpers.ts";

interface WorkflowStep {
  uses?: string;
  name?: string;
  run?: string;
}

interface WorkflowJob {
  steps?: WorkflowStep[];
}

interface Workflow {
  jobs?: Record<string, WorkflowJob>;
}

const WORKFLOWS_DIR = new URL("../.github/workflows/", import.meta.url);
const SHA_PATTERN = /^[0-9a-f]{40}$/;

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

function collectUses(wf: Workflow): string[] {
  const out: string[] = [];
  for (const job of Object.values(wf.jobs ?? {})) {
    for (const step of job?.steps ?? []) {
      if (typeof step.uses === "string" && step.uses.length > 0) {
        out.push(step.uses);
      }
    }
  }
  return out;
}

Deno.test("every workflow pins every action `uses:` to a 40-char commit SHA (#190)", async () => {
  const files = await listWorkflowFiles();
  assert(files.length > 0, "expected at least one workflow file");

  const failures: string[] = [];
  for (const file of files) {
    const wf = await loadWorkflow(file);
    for (const uses of collectUses(wf)) {
      const ref = uses.split("@")[1] ?? "";
      if (!SHA_PATTERN.test(ref)) {
        failures.push(`${file}: '${uses}' — ref '${ref}' is not a 40-char SHA`);
      }
    }
  }

  assert(
    failures.length === 0,
    `Unpinned actions found (must use 40-char commit SHA):\n  ${
      failures.join("\n  ")
    }`,
  );
});
