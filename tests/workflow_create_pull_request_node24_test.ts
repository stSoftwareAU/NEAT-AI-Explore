/**
 * Tests for `peter-evans/create-pull-request` runner currency (#556).
 *
 * The SHA-pinning policy (#190) guarantees every `uses:` is pinned to a
 * 40-char commit SHA, but pinning alone does not stop a workflow from
 * lagging on a build that runs on the deprecated Node.js 20 runtime. The
 * audit flagged `upgrade-dependencies.yml` still pinned to
 * `peter-evans/create-pull-request@22a9089034f40e5a961c8808d113e2c98fb63676`
 * (v7.0.11), whose `action.yml` declares `runs.using: node20` — GitHub
 * flipped the runner default to Node 24 on 2026-06-02 and removes Node 20
 * entirely on 2026-09-16, which would silently kill the weekly dependency
 * bump.
 *
 * v8 moves the runtime to Node 24 with no change to the inputs this repo
 * uses (`token`, `branch`, `base`, `title`, `body`, `commit-message`,
 * `committer`, `author`, `delete-branch`). To foreclose drift, every
 * `peter-evans/create-pull-request` reference must resolve to the v8.1.1
 * SHA and must never resolve to a deprecated Node 20 build.
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

/** v7.0.11 — runs on the deprecated Node 20 runtime. */
const DEPRECATED_NODE20_SHA = "22a9089034f40e5a961c8808d113e2c98fb63676";
/** v8.1.1 — runs on the supported Node 24 runtime. */
const NODE24_SHA = "5f6978faf089d4d20b00c7766989d076bb2fc7f1";

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

/** Collect `[file, sha]` for every `peter-evans/create-pull-request@<sha>`. */
async function collectCreatePrRefs(): Promise<Array<[string, string]>> {
  const refs: Array<[string, string]> = [];
  for (const file of await listWorkflowFiles()) {
    const wf = await loadWorkflow(file);
    for (const job of Object.values(wf.jobs ?? {})) {
      for (const step of job?.steps ?? []) {
        const uses = step.uses;
        if (
          typeof uses === "string" &&
          uses.startsWith("peter-evans/create-pull-request@")
        ) {
          refs.push([file, uses.split("@")[1] ?? ""]);
        }
      }
    }
  }
  return refs;
}

Deno.test("at least one workflow uses `peter-evans/create-pull-request` (#556)", async () => {
  const refs = await collectCreatePrRefs();
  assert(
    refs.length > 0,
    "expected at least one peter-evans/create-pull-request reference",
  );
});

Deno.test("no workflow pins the deprecated Node 20 `create-pull-request` build (#556)", async () => {
  const refs = await collectCreatePrRefs();
  const offenders = refs.filter(([, sha]) => sha === DEPRECATED_NODE20_SHA);
  assertEquals(
    offenders.length,
    0,
    `Found deprecated Node 20 peter-evans/create-pull-request pin(s):\n  ${
      offenders.map(([file, sha]) => `${file}: ${sha}`).join("\n  ")
    }`,
  );
});

Deno.test("every `create-pull-request` reference pins the Node 24 build (#556)", async () => {
  const refs = await collectCreatePrRefs();
  const wrong = refs.filter(([, sha]) => sha !== NODE24_SHA);
  assertEquals(
    wrong.length,
    0,
    `Expected every peter-evans/create-pull-request pin to resolve to ${NODE24_SHA} (v8.1.1, Node 24), found:\n  ${
      refs.map(([file, sha]) => `${file}: ${sha}`).join("\n  ")
    }`,
  );
});
