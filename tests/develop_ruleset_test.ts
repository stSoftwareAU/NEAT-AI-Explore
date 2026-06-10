/**
 * Tests for the Develop branch ruleset (Issue #211).
 *
 * The repo protects the default branch (Develop) with a GitHub ruleset that
 * lists `quality` (the job ID in .github/workflows/deno-quality.yml) as a
 * required status check, so a failing `deno fmt --check`, `deno lint`,
 * `deno check`, or `deno test` blocks PR merge.
 *
 * `.github/rulesets/develop.json` is the settings-as-code mirror of the
 * live ruleset and is the audit trail for the configuration. This test
 * pins the JSON shape so an accidental edit that drops the `quality`
 * required-check or relaxes the rule set is caught locally.
 */

import { assert, assertEquals } from "./test_helpers.ts";

const RULESET_PATH = new URL(
  "../.github/rulesets/develop.json",
  import.meta.url,
);

interface StatusCheck {
  context: string;
  integration_id?: number;
}

interface RequiredStatusChecksRule {
  type: "required_status_checks";
  parameters: {
    strict_required_status_checks_policy?: boolean;
    do_not_enforce_on_create?: boolean;
    required_status_checks: StatusCheck[];
  };
}

interface PullRequestRule {
  type: "pull_request";
  parameters: {
    required_approving_review_count?: number;
    required_review_thread_resolution?: boolean;
    allowed_merge_methods?: string[];
  };
}

interface SimpleRule {
  type: string;
}

type Rule = RequiredStatusChecksRule | PullRequestRule | SimpleRule;

interface Ruleset {
  name: string;
  target: string;
  enforcement: string;
  conditions?: {
    ref_name?: {
      include?: string[];
      exclude?: string[];
    };
  };
  rules: Rule[];
}

async function loadRuleset(): Promise<Ruleset> {
  const text = await Deno.readTextFile(RULESET_PATH);
  return JSON.parse(text) as Ruleset;
}

function findRule<T extends Rule>(
  rules: Rule[],
  type: T["type"],
): T | undefined {
  return rules.find((r) => r.type === type) as T | undefined;
}

Deno.test("develop ruleset file exists and parses as JSON", async () => {
  const ruleset = await loadRuleset();
  assertEquals(ruleset.name, "Develop");
  assertEquals(ruleset.target, "branch");
});

Deno.test("develop ruleset targets the default branch", async () => {
  const ruleset = await loadRuleset();
  const include = ruleset.conditions?.ref_name?.include ?? [];
  assert(
    include.includes("~DEFAULT_BRANCH"),
    `ruleset must target ~DEFAULT_BRANCH, got: ${JSON.stringify(include)}`,
  );
});

Deno.test("develop ruleset is actively enforced", async () => {
  const ruleset = await loadRuleset();
  assertEquals(ruleset.enforcement, "active");
});

Deno.test("develop ruleset requires the 'quality' status check (Issue #211)", async () => {
  const ruleset = await loadRuleset();
  const rule = findRule<RequiredStatusChecksRule>(
    ruleset.rules,
    "required_status_checks",
  );
  assert(rule, "ruleset must include a 'required_status_checks' rule");
  const contexts = rule!.parameters.required_status_checks.map((c) =>
    c.context
  );
  assert(
    contexts.includes("quality"),
    `'quality' must be a required status check, got: ${
      JSON.stringify(contexts)
    }`,
  );
});

Deno.test("develop ruleset uses strict status-check policy", async () => {
  const ruleset = await loadRuleset();
  const rule = findRule<RequiredStatusChecksRule>(
    ruleset.rules,
    "required_status_checks",
  );
  assert(rule, "ruleset must include a 'required_status_checks' rule");
  assertEquals(
    rule!.parameters.strict_required_status_checks_policy,
    true,
    "strict policy must be enabled so the PR must be up to date before merging",
  );
});

Deno.test("develop ruleset requires PR review and thread resolution", async () => {
  const ruleset = await loadRuleset();
  const pr = findRule<PullRequestRule>(ruleset.rules, "pull_request");
  assert(pr, "ruleset must include a 'pull_request' rule");
  assertEquals(
    pr!.parameters.required_approving_review_count,
    1,
    "must require at least one approving review",
  );
  assertEquals(
    pr!.parameters.required_review_thread_resolution,
    true,
    "must require review threads to be resolved before merge",
  );
});

Deno.test("develop ruleset forbids deletion and non-fast-forward pushes", async () => {
  const ruleset = await loadRuleset();
  const types = ruleset.rules.map((r) => r.type);
  assert(
    types.includes("deletion"),
    `ruleset must forbid branch deletion, got types: ${JSON.stringify(types)}`,
  );
  assert(
    types.includes("non_fast_forward"),
    `ruleset must forbid non-fast-forward pushes, got types: ${
      JSON.stringify(types)
    }`,
  );
  assert(
    types.includes("required_linear_history"),
    `ruleset must require linear history, got types: ${JSON.stringify(types)}`,
  );
});

// Note (#331): a README prose grep ("README documents the required 'quality'
// status check") was removed here. It asserted on free-text wording
// (`/Required checks/i`, `/deno-quality\.yml|Deno Quality/i`) and broke on
// routine rewording. The required `quality` status check is already pinned
// durably by the structural ruleset assertions above, which parse
// `.github/rulesets/develop.json` — the source of truth — so no signal is lost.
