/**
 * Every required status check in the checked-in rulesets must be reported by
 * an unfiltered pull-request workflow (#658).
 *
 * A required context that no workflow reports leaves every PR stuck at
 * "Expected". So does a required workflow with a workflow-level `paths:` /
 * `paths-ignore:` filter: GitHub skips the whole run and never posts the
 * check. #656 nearly shipped the second case because the mirror said `a11y`
 * was not required. The rulesets are kept in step with live by
 * `ruleset-drift.yml`, so this test holds against the real branch protection.
 */

import { parse as parseYaml } from "@std/yaml";
import { assert } from "./test_helpers.ts";
import { listWorkflowFiles, WORKFLOWS_DIR } from "./workflow_helpers.ts";
import {
  loadCheckedInRulesets,
  type Ruleset,
} from "../scripts/check_ruleset_drift.ts";

const RULESETS_DIR = new URL("../.github/rulesets/", import.meta.url);
/** GitHub Actions' app id: checks with it are posted by a workflow job. */
const GITHUB_ACTIONS_APP = 15368;

type Trigger = { paths?: unknown; "paths-ignore"?: unknown } | null;

interface Workflow {
  on?: Record<string, Trigger> | string | string[];
  jobs?: Record<string, { name?: string }>;
}

interface Reporter {
  workflow: string;
  triggers: Record<string, Trigger>;
}

/** Map each check-run name (job `name:`, else job id) to its workflow. */
async function checkReporters(): Promise<Map<string, Reporter>> {
  const out = new Map<string, Reporter>();
  for (const file of await listWorkflowFiles()) {
    const wf = parseYaml(
      await Deno.readTextFile(new URL(file, WORKFLOWS_DIR)),
    ) as Workflow;
    const on = wf.on;
    const triggers: Record<string, Trigger> = typeof on === "string"
      ? { [on]: null }
      : Array.isArray(on)
      ? Object.fromEntries(on.map((t) => [t, null]))
      : on ?? {};
    for (const [id, job] of Object.entries(wf.jobs ?? {})) {
      out.set(job?.name ?? id, { workflow: file, triggers });
    }
  }
  return out;
}

function requiredContexts(ruleset: Ruleset): string[] {
  const rules = (ruleset.rules ?? []) as Array<{
    type?: string;
    parameters?: {
      required_status_checks?: Array<
        { context: string; integration_id?: number }
      >;
    };
  }>;
  return rules
    .filter((r) => r.type === "required_status_checks")
    .flatMap((r) => r.parameters?.required_status_checks ?? [])
    .filter((c) => c.integration_id === GITHUB_ACTIONS_APP)
    .map((c) => c.context);
}

Deno.test("every required context is a pull-request workflow job (#658)", async () => {
  const reporters = await checkReporters();
  const rulesets = await loadCheckedInRulesets(RULESETS_DIR);
  assert(rulesets.size > 0, "expected at least one checked-in ruleset");
  for (const [file, ruleset] of rulesets) {
    for (const context of requiredContexts(ruleset)) {
      const reporter = reporters.get(context);
      assert(
        reporter,
        `${file}: required check '${context}' is not the name or id of any ` +
          `job in .github/workflows/, so PRs would wait on it forever`,
      );
      assert(
        "pull_request" in reporter!.triggers,
        `${file}: required check '${context}' comes from ` +
          `${reporter!.workflow}, which has no pull_request trigger`,
      );
    }
  }
});

Deno.test("no required workflow has a workflow-level paths filter (#658)", async () => {
  const reporters = await checkReporters();
  const rulesets = await loadCheckedInRulesets(RULESETS_DIR);
  for (const [file, ruleset] of rulesets) {
    for (const context of requiredContexts(ruleset)) {
      const reporter = reporters.get(context);
      if (!reporter) continue; // reported by the test above
      for (const [event, trigger] of Object.entries(reporter.triggers)) {
        for (const key of ["paths", "paths-ignore"] as const) {
          assert(
            trigger?.[key] === undefined,
            `${reporter.workflow}: '${context}' is required by ${file}, so ` +
              `its ${event} trigger must not set '${key}' — a skipped run ` +
              `never reports the check and the PR cannot merge`,
          );
        }
      }
    }
  }
});
