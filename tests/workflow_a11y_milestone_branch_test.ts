/**
 * Tests that the Accessibility (pa11y-ci) CI workflow runs on milestone PRs (#497).
 *
 * Milestone sub-issue PRs target a shared `milestone/<slug>` branch (the
 * planning delivery workflow). GitHub Actions branch-filter globs treat `*` as
 * "any character except `/`", so a `pull_request.branches: ["*"]` filter never
 * matches a `milestone/<slug>` branch — the Accessibility (pa11y-ci) gate is silently
 * skipped on every intermediate sub-issue PR and only the single rollup PR into
 * the default branch is checked.
 *
 * These tests assert that the workflow's `pull_request.branches` filter matches
 * milestone branches while still matching ordinary single-level branches (e.g.
 * `Develop`), so the fix does not regress the existing coverage.
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
const WORKFLOW = "a11y.yml";

async function loadWorkflow(name: string): Promise<Workflow> {
  const url = new URL(name, WORKFLOWS_DIR);
  const text = await Deno.readTextFile(url);
  return parseYaml(text) as Workflow;
}

/**
 * Replicates GitHub Actions branch-filter glob semantics for a single pattern:
 * `*` matches any run of characters except `/`, `**` matches across `/`, `?`
 * matches a single non-`/` character, and all other characters are literal.
 * See docs: "Patterns to match branches and tags".
 */
function branchGlobMatches(pattern: string, branch: string): boolean {
  let regex = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        regex += ".*"; // `**` crosses `/`
        i++;
      } else {
        regex += "[^/]*"; // `*` stops at `/`
      }
    } else if (ch === "?") {
      regex += "[^/]";
    } else {
      regex += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${regex}$`).test(branch);
}

/** True when any configured branch pattern matches the branch name. */
function anyBranchMatches(patterns: string[], branch: string): boolean {
  return patterns.some((p) => branchGlobMatches(p, branch));
}

function a11yBranches(wf: Workflow): string[] {
  const on = wf.on;
  assert(
    on !== undefined && typeof on === "object" && !Array.isArray(on),
    "a11y.yml must declare an object-form `on:` block",
  );
  const pr = (on as WorkflowTriggers).pull_request;
  assert(
    pr !== undefined && pr !== null,
    "a11y.yml must keep its pull_request trigger so it gates PRs",
  );
  return pr.branches ?? [];
}

Deno.test(
  "a11y.yml runs on milestone/<slug> PRs (#497)",
  async () => {
    const wf = await loadWorkflow(WORKFLOW);
    const branches = a11yBranches(wf);
    for (const branch of ["milestone/foo", "milestone/issue-497-fix"]) {
      assert(
        anyBranchMatches(branches, branch),
        `a11y.yml pull_request.branches must match '${branch}' so the ` +
          `gate runs on milestone PRs. Got branches=${
            JSON.stringify(branches)
          }`,
      );
    }
  },
);

Deno.test(
  "a11y.yml still runs on ordinary single-level branches (#497)",
  async () => {
    const wf = await loadWorkflow(WORKFLOW);
    const branches = a11yBranches(wf);
    for (const branch of ["Develop", "main", "feature-x"]) {
      assert(
        anyBranchMatches(branches, branch),
        `a11y.yml pull_request.branches must still match '${branch}'. ` +
          `Got branches=${JSON.stringify(branches)}`,
      );
    }
  },
);
