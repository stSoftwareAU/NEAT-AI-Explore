/**
 * Tests for `actions/configure-pages` runner currency (#295).
 *
 * The SHA-pinning policy (#190) guarantees every `uses:` is pinned to a
 * 40-char commit SHA, but pinning alone does not stop a workflow from
 * lagging on a build that runs on the deprecated Node.js 20 runtime. The
 * runner flagged the Pages deploy still pinned to
 * `actions/configure-pages@1f0c5cde4bc74cd7e1254d0cb4de8d49e9068c7d`
 * (v4.0.0), which runs on Node 20 — scheduled for removal on GitHub-hosted
 * runners on 2026-09-16.
 *
 * To foreclose that drift, every `actions/configure-pages` reference must
 * resolve to the current major (v6.0.0, which runs on Node 24) and must
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

/** v4.0.0 — runs on the deprecated Node 20 runtime. */
const DEPRECATED_NODE20_SHA = "1f0c5cde4bc74cd7e1254d0cb4de8d49e9068c7d";
/** v6.0.0 — runs on the supported Node 24 runtime. */
const NODE24_SHA = "45bfe0192ca1faeb007ade9deae92b16b8254a0d";

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

/** Collect `[file, sha]` for every `actions/configure-pages@<sha>` reference. */
async function collectConfigurePagesRefs(): Promise<Array<[string, string]>> {
  const refs: Array<[string, string]> = [];
  for (const file of await listWorkflowFiles()) {
    const wf = await loadWorkflow(file);
    for (const job of Object.values(wf.jobs ?? {})) {
      for (const step of job?.steps ?? []) {
        const uses = step.uses;
        if (
          typeof uses === "string" &&
          uses.startsWith("actions/configure-pages@")
        ) {
          refs.push([file, uses.split("@")[1] ?? ""]);
        }
      }
    }
  }
  return refs;
}

Deno.test("at least one workflow uses `actions/configure-pages` (#295)", async () => {
  const refs = await collectConfigurePagesRefs();
  assert(
    refs.length > 0,
    "expected at least one actions/configure-pages reference",
  );
});

Deno.test("no workflow pins the deprecated Node 20 `actions/configure-pages` build (#295)", async () => {
  const refs = await collectConfigurePagesRefs();
  const offenders = refs.filter(([, sha]) => sha === DEPRECATED_NODE20_SHA);
  assertEquals(
    offenders.length,
    0,
    `Found deprecated Node 20 actions/configure-pages pin(s):\n  ${
      offenders.map(([file, sha]) => `${file}: ${sha}`).join("\n  ")
    }`,
  );
});

Deno.test("every `actions/configure-pages` reference pins the Node 24 build (#295)", async () => {
  const refs = await collectConfigurePagesRefs();
  const wrong = refs.filter(([, sha]) => sha !== NODE24_SHA);
  assertEquals(
    wrong.length,
    0,
    `Expected every actions/configure-pages pin to resolve to ${NODE24_SHA} (v6.0.0, Node 24), found:\n  ${
      refs.map(([file, sha]) => `${file}: ${sha}`).join("\n  ")
    }`,
  );
});
