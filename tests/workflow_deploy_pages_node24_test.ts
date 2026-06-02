/**
 * Tests for `actions/deploy-pages` runner currency (#296).
 *
 * The SHA-pinning policy (#190) guarantees every `uses:` is pinned to a
 * 40-char commit SHA, but pinning alone does not stop a workflow from
 * lagging on a build that runs on the deprecated Node.js 20 runtime. The
 * runner flagged the Pages deploy still pinned to
 * `actions/deploy-pages@d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e`
 * (v4.0.5), which runs on Node 20 — scheduled for removal on GitHub-hosted
 * runners on 2026-09-16.
 *
 * To foreclose that drift, every `actions/deploy-pages` reference must
 * resolve to the current major (v5.0.0, which runs on Node 24) and must
 * never resolve to the deprecated Node 20 build.
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

/** v4.0.5 — runs on the deprecated Node 20 runtime. */
const DEPRECATED_NODE20_SHA = "d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e";
/** v5.0.0 — runs on the supported Node 24 runtime. */
const NODE24_SHA = "cd2ce8fcbc39b97be8ca5fce6e763baed58fa128";

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

/** Collect `[file, sha]` for every `actions/deploy-pages@<sha>` reference. */
async function collectDeployPagesRefs(): Promise<Array<[string, string]>> {
  const refs: Array<[string, string]> = [];
  for (const file of await listWorkflowFiles()) {
    const wf = await loadWorkflow(file);
    for (const job of Object.values(wf.jobs ?? {})) {
      for (const step of job?.steps ?? []) {
        const uses = step.uses;
        if (
          typeof uses === "string" &&
          uses.startsWith("actions/deploy-pages@")
        ) {
          refs.push([file, uses.split("@")[1] ?? ""]);
        }
      }
    }
  }
  return refs;
}

Deno.test("at least one workflow uses `actions/deploy-pages` (#296)", async () => {
  const refs = await collectDeployPagesRefs();
  assert(
    refs.length > 0,
    "expected at least one actions/deploy-pages reference",
  );
});

Deno.test("no workflow pins the deprecated Node 20 `actions/deploy-pages` build (#296)", async () => {
  const refs = await collectDeployPagesRefs();
  const offenders = refs.filter(([, sha]) => sha === DEPRECATED_NODE20_SHA);
  assertEquals(
    offenders.length,
    0,
    `Found deprecated Node 20 actions/deploy-pages pin(s):\n  ${
      offenders.map(([file, sha]) => `${file}: ${sha}`).join("\n  ")
    }`,
  );
});

Deno.test("every `actions/deploy-pages` reference pins the Node 24 build (#296)", async () => {
  const refs = await collectDeployPagesRefs();
  const wrong = refs.filter(([, sha]) => sha !== NODE24_SHA);
  assertEquals(
    wrong.length,
    0,
    `Expected every actions/deploy-pages pin to resolve to ${NODE24_SHA} (v5.0.0, Node 24), found:\n  ${
      refs.map(([file, sha]) => `${file}: ${sha}`).join("\n  ")
    }`,
  );
});
