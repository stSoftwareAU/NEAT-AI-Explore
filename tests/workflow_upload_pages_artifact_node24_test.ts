/**
 * Tests for `actions/upload-pages-artifact` runner currency (#297).
 *
 * The SHA-pinning policy (#190) guarantees every `uses:` is pinned to a
 * 40-char commit SHA, but pinning alone does not stop a workflow from
 * lagging on a build that runs on the deprecated Node.js 20 runtime. The
 * runner flagged the Pages deploy still pinned to
 * `actions/upload-pages-artifact@56afc609e74202658d3ffba0e8f6dda462b719fa`
 * (v3.0.1), a composite action that wraps `actions/upload-artifact@v4`,
 * which runs on Node 20 — scheduled for removal on GitHub-hosted runners
 * on 2026-09-16.
 *
 * To foreclose that drift, every `actions/upload-pages-artifact` reference
 * must resolve to the current major (v5.0.0, which wraps
 * `actions/upload-artifact@v7.0.0` and so runs on Node 24) and must never
 * resolve to the deprecated Node 20 build.
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

/** v3.0.1 — wraps actions/upload-artifact@v4, the deprecated Node 20 build. */
const DEPRECATED_NODE20_SHA = "56afc609e74202658d3ffba0e8f6dda462b719fa";
/** v5.0.0 — wraps actions/upload-artifact@v7.0.0, the supported Node 24 build. */
const NODE24_SHA = "fc324d3547104276b827a68afc52ff2a11cc49c9";

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

/** Collect `[file, sha]` for every `actions/upload-pages-artifact@<sha>` reference. */
async function collectUploadPagesArtifactRefs(): Promise<
  Array<[string, string]>
> {
  const refs: Array<[string, string]> = [];
  for (const file of await listWorkflowFiles()) {
    const wf = await loadWorkflow(file);
    for (const job of Object.values(wf.jobs ?? {})) {
      for (const step of job?.steps ?? []) {
        const uses = step.uses;
        if (
          typeof uses === "string" &&
          uses.startsWith("actions/upload-pages-artifact@")
        ) {
          refs.push([file, uses.split("@")[1] ?? ""]);
        }
      }
    }
  }
  return refs;
}

Deno.test("at least one workflow uses `actions/upload-pages-artifact` (#297)", async () => {
  const refs = await collectUploadPagesArtifactRefs();
  assert(
    refs.length > 0,
    "expected at least one actions/upload-pages-artifact reference",
  );
});

Deno.test("no workflow pins the deprecated Node 20 `actions/upload-pages-artifact` build (#297)", async () => {
  const refs = await collectUploadPagesArtifactRefs();
  const offenders = refs.filter(([, sha]) => sha === DEPRECATED_NODE20_SHA);
  assertEquals(
    offenders.length,
    0,
    `Found deprecated Node 20 actions/upload-pages-artifact pin(s):\n  ${
      offenders.map(([file, sha]) => `${file}: ${sha}`).join("\n  ")
    }`,
  );
});

Deno.test("every `actions/upload-pages-artifact` reference pins the Node 24 build (#297)", async () => {
  const refs = await collectUploadPagesArtifactRefs();
  const wrong = refs.filter(([, sha]) => sha !== NODE24_SHA);
  assertEquals(
    wrong.length,
    0,
    `Expected every actions/upload-pages-artifact pin to resolve to ${NODE24_SHA} (v5.0.0, Node 24), found:\n  ${
      refs.map(([file, sha]) => `${file}: ${sha}`).join("\n  ")
    }`,
  );
});
