/**
 * Tests that workflow checkout steps do not persist the GITHUB_TOKEN to disk.
 *
 * By default `actions/checkout` writes the workflow's GITHUB_TOKEN into
 * `.git/config` as an auth header, where any later step in the job — including
 * a compromised dependency or an injected script — can read it and act as the
 * token. A gate job that only reads the tree never pushes back to the repo and
 * never fetches private submodules, so the token does not need to persist.
 * Setting `persist-credentials: false` narrows the blast radius of a
 * compromised step.
 *
 * One data-driven suite replaces the nine near-identical per-workflow files
 * that previously carried this policy (#588); each case keeps its originating
 * issue reference as the step name, so the per-issue provenance survives.
 */

import { assert, assertEquals } from "./test_helpers.ts";
import {
  checkoutSteps,
  jobsWithCheckout,
  listWorkflowFiles,
  loadWorkflow,
} from "./workflow_helpers.ts";

interface Case {
  workflow: string;
  job: string;
  ref: string;
}

/** Jobs whose checkout must not leave the token on disk. */
const CASES: Case[] = [
  { workflow: "a11y.yml", job: "a11y", ref: "#455" },
  { workflow: "actionlint.yml", job: "actionlint", ref: "#456" },
  { workflow: "bash-syntax.yml", job: "bash-syntax", ref: "#588" },
  { workflow: "deno-quality.yml", job: "quality", ref: "#457" },
  { workflow: "dependency-audit.yml", job: "audit", ref: "#458" },
  { workflow: "dependency-review.yml", job: "dependency-review", ref: "#459" },
  {
    workflow: "dependency-quarantine.yml",
    job: "dependency-quarantine",
    ref: "#616",
  },
  { workflow: "deploy.yml", job: "deploy", ref: "#460" },
  { workflow: "markdown-lint.yml", job: "markdownlint", ref: "#461" },
  { workflow: "semgrep.yml", job: "semgrep", ref: "#462" },
  { workflow: "shellcheck.yml", job: "shellcheck", ref: "#463" },
];

/**
 * Workflows deliberately outside the policy, each with the reason it is out.
 * A workflow that pushes back to the repository needs its credential to
 * survive the checkout step.
 */
const EXEMPT = new Map<string, string>([
  [
    "semver-bump.yml",
    "checks out with secrets.ACTIONS_PUSH and pushes the version bump back " +
    "to the PR branch, so the credential must persist",
  ],
  [
    "upgrade-dependencies.yml",
    "checks out with a push token and commits the weekly dependency bump, " +
    "so the credential must persist",
  ],
  [
    "gitleaks.yml",
    "checks out with fetch-depth: 0 for the secret scan and has never been " +
    "part of this policy; unchanged by the #588 consolidation",
  ],
]);

Deno.test("guarded jobs check out the repository", async (t) => {
  for (const c of CASES) {
    await t.step(`${c.workflow} / ${c.job} (${c.ref})`, async () => {
      const wf = await loadWorkflow(c.workflow);
      const steps = checkoutSteps(wf.jobs?.[c.job]);
      assert(
        steps.length > 0,
        `${c.job} job must have an actions/checkout step`,
      );
    });
  }
});

Deno.test("guarded checkouts do not persist the GITHUB_TOKEN to disk", async (t) => {
  for (const c of CASES) {
    await t.step(`${c.workflow} / ${c.job} (${c.ref})`, async () => {
      const wf = await loadWorkflow(c.workflow);
      const steps = checkoutSteps(wf.jobs?.[c.job]);
      assert(steps.length > 0, `${c.job} job must have a checkout step`);
      for (const step of steps) {
        assert(
          step.with !== undefined && step.with !== null,
          `${c.job} checkout must set \`with.persist-credentials: false\``,
        );
        assertEquals(
          step.with["persist-credentials"],
          false,
          `${c.job} checkout must set \`persist-credentials: false\` so the ` +
            "token is not written to .git/config",
        );
      }
    });
  }
});

Deno.test("every workflow checkout is guarded or documented as exempt (#588)", async () => {
  const covered = new Set(CASES.map((c) => `${c.workflow}:${c.job}`));
  const unguarded: string[] = [];
  for (const file of await listWorkflowFiles()) {
    if (EXEMPT.has(file)) continue;
    const wf = await loadWorkflow(file);
    for (const job of jobsWithCheckout(wf)) {
      if (!covered.has(`${file}:${job}`)) unguarded.push(`${file}: ${job}`);
    }
  }
  assertEquals(
    unguarded.length,
    0,
    "Every job that checks out the repository must appear in CASES or its " +
      `workflow in EXEMPT with a reason. Unguarded:\n  ${
        unguarded.join("\n  ")
      }`,
  );
});

Deno.test("no stale workflow entries in the policy tables (#588)", async () => {
  const present = new Set(await listWorkflowFiles());
  const missing = [
    ...CASES.map((c) => c.workflow),
    ...EXEMPT.keys(),
  ].filter((w) => !present.has(w));
  assertEquals(
    missing.length,
    0,
    `Policy tables name workflows that no longer exist: ${
      [...new Set(missing)].join(", ")
    }`,
  );
});
