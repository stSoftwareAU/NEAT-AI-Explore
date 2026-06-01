/**
 * Tests for `actions/checkout` version consistency (#293).
 *
 * The SHA-pinning policy (#190) guarantees every `uses:` is pinned to a
 * 40-char commit SHA, but pinning alone does not stop individual workflows
 * from lagging on an old, deprecated build. The runner flagged several
 * workflows still pinned to `actions/checkout` releases that run on the
 * deprecated Node.js 20 runtime, while others had already moved to the
 * current major.
 *
 * To foreclose that drift, every `actions/checkout` reference across all
 * workflows must resolve to the SAME commit SHA. When the action is bumped,
 * it is bumped everywhere — so the fleet can never split between a current
 * (supported Node) build and a deprecated (Node 20) one.
 */

import { parse as parseYaml } from "@std/yaml";
import { assert, assertEquals } from "./test_helpers.ts";

interface WorkflowStep {
  uses?: string;
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

/** Collect `[file, sha]` for every `actions/checkout@<sha>` reference. */
async function collectCheckoutRefs(): Promise<Array<[string, string]>> {
  const refs: Array<[string, string]> = [];
  for (const file of await listWorkflowFiles()) {
    const wf = await loadWorkflow(file);
    for (const job of Object.values(wf.jobs ?? {})) {
      for (const step of job?.steps ?? []) {
        const uses = step.uses;
        if (typeof uses === "string" && uses.startsWith("actions/checkout@")) {
          refs.push([file, uses.split("@")[1] ?? ""]);
        }
      }
    }
  }
  return refs;
}

Deno.test("every workflow uses `actions/checkout` (#293)", async () => {
  const refs = await collectCheckoutRefs();
  assert(refs.length > 0, "expected at least one actions/checkout reference");
});

Deno.test("all `actions/checkout` references resolve to one SHA (#293)", async () => {
  const refs = await collectCheckoutRefs();
  const unique = [...new Set(refs.map(([, sha]) => sha))];
  assertEquals(
    unique.length,
    1,
    `Expected a single pinned actions/checkout SHA across all workflows, found ${unique.length}:\n  ${
      refs.map(([file, sha]) => `${file}: ${sha}`).join("\n  ")
    }`,
  );
});
