/**
 * Tests that the actionlint checker workflow does not re-run on push to the
 * default branch (#453).
 *
 * `actionlint.yml` is a test/lint workflow: it gates pull requests. When it
 * also triggers on `push:` to the default branch (`Develop`), every merge
 * re-runs the exact check that already passed on the PR — wasting runner
 * minutes and risking a red tick on the default branch for a check that has
 * already succeeded. Deploy/publish/release workflows are different (they must
 * fire on push), but a checker should gate the PR only.
 *
 * These tests assert that actionlint.yml keeps its `pull_request` trigger and
 * no longer pushes on the default branch.
 */

import { parse as parseYaml } from "@std/yaml";
import { assert } from "./test_helpers.ts";

interface PushTrigger {
  branches?: string[];
}

interface WorkflowTriggers {
  pull_request?: unknown;
  push?: PushTrigger | null;
}

interface Workflow {
  on?: WorkflowTriggers | string | string[];
}

const WORKFLOWS_DIR = new URL("../.github/workflows/", import.meta.url);
const ACTIONLINT_WORKFLOW = "actionlint.yml";
const DEFAULT_BRANCH = "Develop";

async function loadWorkflow(name: string): Promise<Workflow> {
  const url = new URL(name, WORKFLOWS_DIR);
  const text = await Deno.readTextFile(url);
  return parseYaml(text) as Workflow;
}

Deno.test(
  "actionlint.yml still gates pull requests (#453)",
  async () => {
    const wf = await loadWorkflow(ACTIONLINT_WORKFLOW);
    const on = wf.on;
    assert(
      on !== undefined && typeof on === "object" && !Array.isArray(on),
      "actionlint.yml must declare an object-form `on:` block",
    );
    assert(
      "pull_request" in (on as WorkflowTriggers),
      "actionlint.yml must keep its pull_request trigger so it gates PRs",
    );
  },
);

Deno.test(
  "actionlint.yml does not re-run on push to the default branch (#453)",
  async () => {
    const wf = await loadWorkflow(ACTIONLINT_WORKFLOW);
    const on = wf.on as WorkflowTriggers;
    const push = on.push;

    // No push trigger at all is fine — the checker gates the PR only.
    if (push === undefined || push === null) return;

    const branches = push.branches ?? [];
    assert(
      !branches.includes(DEFAULT_BRANCH),
      `actionlint.yml must not trigger on push to the default branch ` +
        `('${DEFAULT_BRANCH}'); the post-merge run duplicates the PR run. ` +
        `Got push.branches=${JSON.stringify(branches)}`,
    );
  },
);
