/**
 * Tests for `actions/upload-artifact` runner currency (#555).
 *
 * The SHA-pinning policy (#190) guarantees every `uses:` is pinned to a
 * 40-char commit SHA, but pinning alone does not stop a workflow from
 * lagging on a build that runs on the deprecated Node.js 20 runtime. The
 * runner flagged the Pages deploy still pinned to
 * `actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02`
 * (v4.6.2), whose `action.yml` declares `runs.using: node20` — a runtime
 * force-upgraded on GitHub-hosted runners on 2026-06-02 and scheduled for
 * removal on 2026-09-16. Because the pin is a commit SHA, no tag movement
 * will ever pull in a fixed runtime, so the break is guaranteed unless the
 * pin is bumped.
 *
 * To foreclose that drift, every `actions/upload-artifact` reference must
 * resolve to the current major (v7.0.1, which runs on Node 24 and matches
 * the v7 build already wrapped by `actions/upload-pages-artifact` in the
 * same workflow) and must never resolve to the deprecated Node 20 build.
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

/** v4.6.2 — declares `runs.using: node20`, the deprecated runtime. */
const DEPRECATED_NODE20_SHA = "ea165f8d65b6e75b540449e92b4886f43607fa02";
/** v7.0.1 — declares `runs.using: node24`, the supported runtime. */
const NODE24_SHA = "043fb46d1a93c77aae656e7c1c64a875d1fc6a0a";

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

/**
 * Collect `[file, sha]` for every `actions/upload-artifact@<sha>` reference.
 *
 * Anchored on `actions/upload-artifact@` so it never matches the distinct
 * `actions/upload-pages-artifact@` action, which has its own currency test.
 */
async function collectUploadArtifactRefs(): Promise<Array<[string, string]>> {
  const refs: Array<[string, string]> = [];
  for (const file of await listWorkflowFiles()) {
    const wf = await loadWorkflow(file);
    for (const job of Object.values(wf.jobs ?? {})) {
      for (const step of job?.steps ?? []) {
        const uses = step.uses;
        if (
          typeof uses === "string" &&
          uses.startsWith("actions/upload-artifact@")
        ) {
          refs.push([file, uses.split("@")[1] ?? ""]);
        }
      }
    }
  }
  return refs;
}

Deno.test("at least one workflow uses `actions/upload-artifact` (#555)", async () => {
  const refs = await collectUploadArtifactRefs();
  assert(
    refs.length > 0,
    "expected at least one actions/upload-artifact reference",
  );
});

Deno.test("no workflow pins the deprecated Node 20 `actions/upload-artifact` build (#555)", async () => {
  const refs = await collectUploadArtifactRefs();
  const offenders = refs.filter(([, sha]) => sha === DEPRECATED_NODE20_SHA);
  assertEquals(
    offenders.length,
    0,
    `Found deprecated Node 20 actions/upload-artifact pin(s):\n  ${
      offenders.map(([file, sha]) => `${file}: ${sha}`).join("\n  ")
    }`,
  );
});

Deno.test("every `actions/upload-artifact` reference pins the Node 24 build (#555)", async () => {
  const refs = await collectUploadArtifactRefs();
  const wrong = refs.filter(([, sha]) => sha !== NODE24_SHA);
  assertEquals(
    wrong.length,
    0,
    `Expected every actions/upload-artifact pin to resolve to ${NODE24_SHA} (v7.0.1, Node 24), found:\n  ${
      refs.map(([file, sha]) => `${file}: ${sha}`).join("\n  ")
    }`,
  );
});
