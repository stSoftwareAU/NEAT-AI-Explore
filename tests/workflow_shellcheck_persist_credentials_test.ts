/**
 * Tests that the ShellCheck workflow's checkout step does not persist the
 * GITHUB_TOKEN to disk (#463).
 *
 * By default `actions/checkout` writes the workflow's GITHUB_TOKEN into
 * `.git/config` as an auth header, where any later step in the job — including
 * a compromised dependency or an injected script — can read it and act as the
 * token. The `shellcheck` job only reads the tree to run ShellCheck; it never
 * pushes back to the repo or fetches private submodules, so the token does not
 * need to persist. Setting `persist-credentials: false` narrows the blast
 * radius of a compromised step.
 *
 * This test parses the workflow YAML and asserts the checkout step in the
 * `shellcheck` job sets `persist-credentials: false`.
 */

import { parse as parseYaml } from "@std/yaml";
import { assert, assertEquals } from "./test_helpers.ts";

interface WorkflowStep {
  uses?: string;
  with?: Record<string, unknown>;
}

interface WorkflowJob {
  steps?: WorkflowStep[];
}

interface Workflow {
  jobs?: Record<string, WorkflowJob>;
}

const WORKFLOWS_DIR = new URL("../.github/workflows/", import.meta.url);
const SHELLCHECK_WORKFLOW = "shellcheck.yml";

async function loadWorkflow(name: string): Promise<Workflow> {
  const url = new URL(name, WORKFLOWS_DIR);
  const text = await Deno.readTextFile(url);
  return parseYaml(text) as Workflow;
}

/** Return every `actions/checkout` step in the given job. */
function checkoutSteps(job: WorkflowJob | undefined): WorkflowStep[] {
  return (job?.steps ?? []).filter((step) =>
    typeof step.uses === "string" &&
    step.uses.startsWith("actions/checkout@")
  );
}

Deno.test(
  "shellcheck job checks out the repository (#463)",
  async () => {
    const wf = await loadWorkflow(SHELLCHECK_WORKFLOW);
    const steps = checkoutSteps(wf.jobs?.shellcheck);
    assert(
      steps.length > 0,
      "shellcheck job must have an actions/checkout step",
    );
  },
);

Deno.test(
  "shellcheck checkout does not persist the GITHUB_TOKEN to disk (#463)",
  async () => {
    const wf = await loadWorkflow(SHELLCHECK_WORKFLOW);
    for (const step of checkoutSteps(wf.jobs?.shellcheck)) {
      assert(
        step.with !== undefined && step.with !== null,
        "shellcheck checkout must set `with.persist-credentials: false`",
      );
      assertEquals(
        step.with["persist-credentials"],
        false,
        "shellcheck checkout must set `persist-credentials: false` so the " +
          "token is not written to .git/config",
      );
    }
  },
);
