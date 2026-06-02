/**
 * Tests for `actions/setup-node` runner currency (#294).
 *
 * The SHA-pinning policy (#190) guarantees every `uses:` is pinned to a
 * 40-char commit SHA, but pinning alone does not stop a workflow from
 * lagging on a build that runs on the deprecated Node.js 20 runtime. The
 * runner flagged `markdown-lint.yml` still pinned to
 * `actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020` (v4), which
 * runs on Node 20 — GitHub flips the runner default to Node 24 on
 * 2026-06-02 and removes Node 20 entirely on 2026-09-16.
 *
 * actions/setup-node v6.4.0 runs on the supported Node 24 runtime with no
 * changes to the inputs this repository uses (`node-version`). To foreclose
 * drift, every `actions/setup-node` reference must resolve to the v6.4.0 SHA
 * and must never resolve to the deprecated Node 20 build.
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

/** v4 — runs on the deprecated Node 20 runtime. */
const DEPRECATED_NODE20_SHA = "49933ea5288caeca8642d1e84afbd3f7d6820020";
/** v6.4.0 — runs on the supported Node 24 runtime. */
const NODE24_SHA = "48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e";

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

/** Collect `[file, sha]` for every `actions/setup-node@<sha>` reference. */
async function collectSetupNodeRefs(): Promise<Array<[string, string]>> {
  const refs: Array<[string, string]> = [];
  for (const file of await listWorkflowFiles()) {
    const wf = await loadWorkflow(file);
    for (const job of Object.values(wf.jobs ?? {})) {
      for (const step of job?.steps ?? []) {
        const uses = step.uses;
        if (
          typeof uses === "string" &&
          uses.startsWith("actions/setup-node@")
        ) {
          refs.push([file, uses.split("@")[1] ?? ""]);
        }
      }
    }
  }
  return refs;
}

Deno.test("at least one workflow uses `actions/setup-node` (#294)", async () => {
  const refs = await collectSetupNodeRefs();
  assert(
    refs.length > 0,
    "expected at least one actions/setup-node reference",
  );
});

Deno.test("no workflow pins the deprecated Node 20 `actions/setup-node` build (#294)", async () => {
  const refs = await collectSetupNodeRefs();
  const offenders = refs.filter(([, sha]) => sha === DEPRECATED_NODE20_SHA);
  assertEquals(
    offenders.length,
    0,
    `Found deprecated Node 20 actions/setup-node pin(s):\n  ${
      offenders.map(([file, sha]) => `${file}: ${sha}`).join("\n  ")
    }`,
  );
});

Deno.test("every `actions/setup-node` reference pins the Node 24 build (#294)", async () => {
  const refs = await collectSetupNodeRefs();
  const wrong = refs.filter(([, sha]) => sha !== NODE24_SHA);
  assertEquals(
    wrong.length,
    0,
    `Expected every actions/setup-node pin to resolve to ${NODE24_SHA} (v6.4.0, Node 24), found:\n  ${
      refs.map(([file, sha]) => `${file}: ${sha}`).join("\n  ")
    }`,
  );
});
