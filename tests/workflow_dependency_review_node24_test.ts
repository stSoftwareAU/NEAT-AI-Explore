/**
 * Tests for `actions/dependency-review-action` runner currency (#299).
 *
 * The SHA-pinning policy (#190) guarantees every `uses:` is pinned to a
 * 40-char commit SHA, but pinning alone does not stop a workflow from
 * lagging on a build that runs on the deprecated Node.js 20 runtime. The
 * runner flagged the Dependency Review job still pinned to
 * `actions/dependency-review-action@2031cfc080254a8a887f58cffee85186f0e49e48`
 * (v4.9.0), which runs on Node 20 — scheduled for removal on GitHub-hosted
 * runners on 2026-09-16.
 *
 * To foreclose that drift, every `actions/dependency-review-action`
 * reference must resolve to the current major (v5.0.0, which runs on
 * Node 24) and must never resolve to the deprecated Node 20 build.
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

/** v4.9.0 — runs on the deprecated Node 20 runtime. */
const DEPRECATED_NODE20_SHA = "2031cfc080254a8a887f58cffee85186f0e49e48";
/** v5.0.0 — runs on the supported Node 24 runtime. */
const NODE24_SHA = "a1d282b36b6f3519aa1f3fc636f609c47dddb294";

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

/** Collect `[file, sha]` for every `actions/dependency-review-action@<sha>`. */
async function collectDependencyReviewRefs(): Promise<Array<[string, string]>> {
  const refs: Array<[string, string]> = [];
  for (const file of await listWorkflowFiles()) {
    const wf = await loadWorkflow(file);
    for (const job of Object.values(wf.jobs ?? {})) {
      for (const step of job?.steps ?? []) {
        const uses = step.uses;
        if (
          typeof uses === "string" &&
          uses.startsWith("actions/dependency-review-action@")
        ) {
          refs.push([file, uses.split("@")[1] ?? ""]);
        }
      }
    }
  }
  return refs;
}

Deno.test("at least one workflow uses `actions/dependency-review-action` (#299)", async () => {
  const refs = await collectDependencyReviewRefs();
  assert(
    refs.length > 0,
    "expected at least one actions/dependency-review-action reference",
  );
});

Deno.test("no workflow pins the deprecated Node 20 `actions/dependency-review-action` build (#299)", async () => {
  const refs = await collectDependencyReviewRefs();
  const offenders = refs.filter(([, sha]) => sha === DEPRECATED_NODE20_SHA);
  assertEquals(
    offenders.length,
    0,
    `Found deprecated Node 20 actions/dependency-review-action pin(s):\n  ${
      offenders.map(([file, sha]) => `${file}: ${sha}`).join("\n  ")
    }`,
  );
});

Deno.test("every `actions/dependency-review-action` reference pins the Node 24 build (#299)", async () => {
  const refs = await collectDependencyReviewRefs();
  const wrong = refs.filter(([, sha]) => sha !== NODE24_SHA);
  assertEquals(
    wrong.length,
    0,
    `Expected every actions/dependency-review-action pin to resolve to ${NODE24_SHA} (v5.0.0, Node 24), found:\n  ${
      refs.map(([file, sha]) => `${file}: ${sha}`).join("\n  ")
    }`,
  );
});
