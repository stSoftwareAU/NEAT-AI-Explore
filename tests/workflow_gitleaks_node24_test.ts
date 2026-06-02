/**
 * Tests for `gitleaks/gitleaks-action` runner currency (#298).
 *
 * The SHA-pinning policy (#190) guarantees every `uses:` is pinned to a
 * 40-char commit SHA, but pinning alone does not stop a workflow from
 * lagging on a build that runs on the deprecated Node.js 20 runtime. The
 * runner flagged `gitleaks.yml` still pinned to
 * `gitleaks/gitleaks-action@ff98106e4c7b2bc287b24eaf42907196329070c7`
 * (v2.3.9), which runs on Node 20 — GitHub flips the runner default to
 * Node 24 on 2026-06-02 and removes Node 20 entirely on 2026-09-16.
 *
 * gitleaks-action v3.0.0 migrates the runtime from Node 20 to Node 24 with
 * no changes to inputs, outputs, or behaviour. To foreclose drift, every
 * `gitleaks/gitleaks-action` reference must resolve to the v3.0.0 SHA and
 * must never resolve to the deprecated Node 20 build.
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

/** v2.3.9 — runs on the deprecated Node 20 runtime. */
const DEPRECATED_NODE20_SHA = "ff98106e4c7b2bc287b24eaf42907196329070c7";
/** v3.0.0 — runs on the supported Node 24 runtime. */
const NODE24_SHA = "e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e";

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

/** Collect `[file, sha]` for every `gitleaks/gitleaks-action@<sha>` reference. */
async function collectGitleaksRefs(): Promise<Array<[string, string]>> {
  const refs: Array<[string, string]> = [];
  for (const file of await listWorkflowFiles()) {
    const wf = await loadWorkflow(file);
    for (const job of Object.values(wf.jobs ?? {})) {
      for (const step of job?.steps ?? []) {
        const uses = step.uses;
        if (
          typeof uses === "string" &&
          uses.startsWith("gitleaks/gitleaks-action@")
        ) {
          refs.push([file, uses.split("@")[1] ?? ""]);
        }
      }
    }
  }
  return refs;
}

Deno.test("at least one workflow uses `gitleaks/gitleaks-action` (#298)", async () => {
  const refs = await collectGitleaksRefs();
  assert(
    refs.length > 0,
    "expected at least one gitleaks/gitleaks-action reference",
  );
});

Deno.test("no workflow pins the deprecated Node 20 `gitleaks/gitleaks-action` build (#298)", async () => {
  const refs = await collectGitleaksRefs();
  const offenders = refs.filter(([, sha]) => sha === DEPRECATED_NODE20_SHA);
  assertEquals(
    offenders.length,
    0,
    `Found deprecated Node 20 gitleaks/gitleaks-action pin(s):\n  ${
      offenders.map(([file, sha]) => `${file}: ${sha}`).join("\n  ")
    }`,
  );
});

Deno.test("every `gitleaks/gitleaks-action` reference pins the Node 24 build (#298)", async () => {
  const refs = await collectGitleaksRefs();
  const wrong = refs.filter(([, sha]) => sha !== NODE24_SHA);
  assertEquals(
    wrong.length,
    0,
    `Expected every gitleaks/gitleaks-action pin to resolve to ${NODE24_SHA} (v3.0.0, Node 24), found:\n  ${
      refs.map(([file, sha]) => `${file}: ${sha}`).join("\n  ")
    }`,
  );
});
