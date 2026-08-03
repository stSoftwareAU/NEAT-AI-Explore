/**
 * Tests that the CI gates run on milestone PRs.
 *
 * Milestone sub-issue PRs target a shared `milestone/<slug>` branch (the
 * planning delivery workflow). GitHub Actions branch-filter globs treat `*` as
 * "any character except `/`", so a `pull_request.branches: ["*"]` filter never
 * matches a `milestone/<slug>` branch — the gate is silently skipped on every
 * intermediate sub-issue PR and only the single rollup PR into the default
 * branch is checked.
 *
 * These tests assert each gate's `pull_request.branches` filter matches
 * milestone branches while still matching ordinary single-level branches (e.g.
 * `Develop`), so the fix does not regress the existing coverage.
 *
 * One data-driven suite replaces the ten near-identical per-workflow files
 * that previously carried this policy (#588); each case keeps its originating
 * issue reference as the step name, so the per-issue provenance survives.
 */

import { assert, assertEquals } from "./test_helpers.ts";
import {
  listWorkflowFiles,
  loadWorkflow,
  type Workflow,
  type WorkflowTriggers,
} from "./workflow_helpers.ts";

interface Case {
  workflow: string;
  ref: string;
}

/** Gates that must run on milestone sub-issue PRs. */
const CASES: Case[] = [
  { workflow: "a11y.yml", ref: "#497" },
  { workflow: "actionlint.yml", ref: "#492" },
  { workflow: "bash-syntax.yml", ref: "#497" },
  { workflow: "deno-quality.yml", ref: "#493" },
  { workflow: "dependency-audit.yml", ref: "#497" },
  { workflow: "dependency-review.yml", ref: "#497" },
  { workflow: "gitleaks.yml", ref: "#494" },
  { workflow: "markdown-lint.yml", ref: "#495" },
  { workflow: "semgrep.yml", ref: "#496" },
  { workflow: "shellcheck.yml", ref: "#497" },
];

/**
 * Workflows with a `pull_request` trigger that deliberately sit outside the
 * policy, each with the reason it is out.
 */
const EXEMPT = new Map<string, string>([
  [
    "semver-bump.yml",
    "gates only PRs into Develop (`branches: [Develop]`) because the version " +
    "bump belongs to the rollup PR, not to milestone sub-issue PRs",
  ],
]);

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

/** The `pull_request.branches` filter, asserting the trigger is still there. */
function pullRequestBranches(wf: Workflow, file: string): string[] {
  const on = wf.on;
  assert(
    on !== undefined && typeof on === "object" && !Array.isArray(on),
    `${file} must declare an object-form \`on:\` block`,
  );
  const pr = (on as WorkflowTriggers).pull_request;
  assert(
    pr !== undefined && pr !== null,
    `${file} must keep its pull_request trigger so it gates PRs`,
  );
  return pr.branches ?? [];
}

/** True when the workflow declares a `pull_request` trigger at all. */
function hasPullRequestTrigger(wf: Workflow): boolean {
  const on = wf.on;
  if (on === undefined || typeof on !== "object" || Array.isArray(on)) {
    return false;
  }
  return (on as WorkflowTriggers).pull_request !== undefined;
}

Deno.test("gates run on milestone/<slug> PRs", async (t) => {
  for (const c of CASES) {
    await t.step(`${c.workflow} (${c.ref})`, async () => {
      const wf = await loadWorkflow(c.workflow);
      const branches = pullRequestBranches(wf, c.workflow);
      for (const branch of ["milestone/foo", "milestone/issue-497-fix"]) {
        assert(
          anyBranchMatches(branches, branch),
          `${c.workflow} pull_request.branches must match '${branch}' so the ` +
            `gate runs on milestone PRs. Got branches=${
              JSON.stringify(branches)
            }`,
        );
      }
    });
  }
});

Deno.test("gates still run on ordinary single-level branches", async (t) => {
  for (const c of CASES) {
    await t.step(`${c.workflow} (${c.ref})`, async () => {
      const wf = await loadWorkflow(c.workflow);
      const branches = pullRequestBranches(wf, c.workflow);
      for (const branch of ["Develop", "main", "feature-x"]) {
        assert(
          anyBranchMatches(branches, branch),
          `${c.workflow} pull_request.branches must still match '${branch}'. ` +
            `Got branches=${JSON.stringify(branches)}`,
        );
      }
    });
  }
});

Deno.test("every pull_request workflow is covered or documented as exempt (#588)", async () => {
  const covered = new Set(CASES.map((c) => c.workflow));
  const uncovered: string[] = [];
  for (const file of await listWorkflowFiles()) {
    if (covered.has(file) || EXEMPT.has(file)) continue;
    const wf = await loadWorkflow(file);
    if (hasPullRequestTrigger(wf)) uncovered.push(file);
  }
  assertEquals(
    uncovered.length,
    0,
    "Every workflow with a pull_request trigger must appear in CASES or in " +
      `EXEMPT with a reason. Uncovered:\n  ${uncovered.join("\n  ")}`,
  );
});

Deno.test("no stale workflow entries in the milestone tables (#588)", async () => {
  const present = new Set(await listWorkflowFiles());
  const missing = [...CASES.map((c) => c.workflow), ...EXEMPT.keys()]
    .filter((w) => !present.has(w));
  assertEquals(
    missing.length,
    0,
    `Milestone tables name workflows that no longer exist: ${
      [...new Set(missing)].join(", ")
    }`,
  );
});
