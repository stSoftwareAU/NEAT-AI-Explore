/**
 * Tests that the actionlint checker workflow gates milestone PRs (#492).
 *
 * Milestone sub-issue PRs target a shared `milestone/<slug>` branch. GitHub's
 * `pull_request.branches` glob `*` does not cross a `/`, so a filter of `["*"]`
 * matches single-segment branches (`Develop`, `main`) but never a
 * `milestone/<slug>` branch. With that filter the actionlint gate is skipped
 * on every milestone sub-issue PR, so workflow regressions merge into the
 * milestone branch unchecked and are only caught by the rollup PR into the
 * default branch.
 *
 * These tests assert that actionlint.yml's `pull_request` branch filter
 * includes a glob that matches `milestone/<slug>` branches.
 */

import { parse as parseYaml } from "@std/yaml";
import { assert } from "./test_helpers.ts";

interface PullRequestTrigger {
  branches?: string[];
}

interface WorkflowTriggers {
  pull_request?: PullRequestTrigger | null;
}

interface Workflow {
  on?: WorkflowTriggers | string | string[];
}

const WORKFLOWS_DIR = new URL("../.github/workflows/", import.meta.url);
const ACTIONLINT_WORKFLOW = "actionlint.yml";
const MILESTONE_BRANCH = "milestone/my-feature";

async function loadWorkflow(name: string): Promise<Workflow> {
  const url = new URL(name, WORKFLOWS_DIR);
  const text = await Deno.readTextFile(url);
  return parseYaml(text) as Workflow;
}

/**
 * Mimics GitHub's branch-filter glob matching: `*` matches any run of
 * characters except `/`, so `milestone/*` matches `milestone/foo` but `*`
 * does not.
 */
function branchGlobMatches(glob: string, branch: string): boolean {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const pattern = "^" + escaped.replace(/\*/g, "[^/]*") + "$";
  return new RegExp(pattern).test(branch);
}

function pullRequestBranches(wf: Workflow): string[] {
  const on = wf.on;
  assert(
    on !== undefined && typeof on === "object" && !Array.isArray(on),
    "actionlint.yml must declare an object-form `on:` block",
  );
  const pr = (on as WorkflowTriggers).pull_request;
  assert(
    pr !== undefined && pr !== null,
    "actionlint.yml must keep its pull_request trigger so it gates PRs",
  );
  return (pr as PullRequestTrigger).branches ?? [];
}

Deno.test(
  "actionlint.yml gates milestone/<slug> PRs (#492)",
  async () => {
    const wf = await loadWorkflow(ACTIONLINT_WORKFLOW);
    const branches = pullRequestBranches(wf);
    assert(
      branches.some((glob) => branchGlobMatches(glob, MILESTONE_BRANCH)),
      `actionlint.yml pull_request.branches must match a milestone branch ` +
        `('${MILESTONE_BRANCH}'); the single-level '*' glob does not cross ` +
        `'/'. Got branches=${JSON.stringify(branches)}`,
    );
  },
);

Deno.test(
  "actionlint.yml still gates default-branch PRs (#492)",
  async () => {
    const wf = await loadWorkflow(ACTIONLINT_WORKFLOW);
    const branches = pullRequestBranches(wf);
    assert(
      branches.some((glob) => branchGlobMatches(glob, "Develop")),
      `actionlint.yml pull_request.branches must still match the default ` +
        `branch ('Develop'). Got branches=${JSON.stringify(branches)}`,
    );
  },
);
