/**
 * Tests that the a11y workflow's npm install step retries on transient network
 * errors (PR #473).
 *
 * The a11y gate installs `pa11y-ci` and `http-server` globally via npm. A single
 * transient npm network error (observed as `ECONNRESET` mid-download) failed the
 * whole gate with no retry. This step must retry with backoff and still fail
 * loud — exit non-zero — once all attempts are exhausted, so a genuine install
 * failure is never masked as success.
 *
 * This test parses the workflow YAML and asserts the install step both loops
 * over `npm install` attempts and exits non-zero after they are exhausted.
 */

import { parse as parseYaml } from "@std/yaml";
import { assert } from "./test_helpers.ts";

interface WorkflowStep {
  name?: string;
  run?: string;
}

interface WorkflowJob {
  steps?: WorkflowStep[];
}

interface Workflow {
  jobs?: Record<string, WorkflowJob>;
}

const WORKFLOWS_DIR = new URL("../.github/workflows/", import.meta.url);

async function loadWorkflow(name: string): Promise<Workflow> {
  const url = new URL(name, WORKFLOWS_DIR);
  const text = await Deno.readTextFile(url);
  return parseYaml(text) as Workflow;
}

function installStep(job: WorkflowJob | undefined): WorkflowStep | undefined {
  return (job?.steps ?? []).find((step) =>
    typeof step.run === "string" && step.run.includes("npm install -g")
  );
}

Deno.test(
  "a11y npm install retries on transient network errors (PR #473)",
  async () => {
    const wf = await loadWorkflow("a11y.yml");
    const step = installStep(wf.jobs?.a11y);
    assert(
      step !== undefined,
      "a11y job must have an npm install step",
    );
    const run = step!.run ?? "";
    assert(
      /for\s+\w+\s+in\s+1\s+2\s+3/.test(run),
      "install step must loop over multiple attempts to survive a transient " +
        "npm network error",
    );
    assert(
      /npm install -g pa11y-ci@\S+ http-server@\S+/.test(run),
      "install step must install pa11y-ci and http-server (version-pinned " +
        "since #617; the pins themselves are asserted by " +
        "workflow_npm_install_pinning_test.ts)",
    );
  },
);

Deno.test(
  "a11y npm install fails loud after exhausting retries (PR #473)",
  async () => {
    const wf = await loadWorkflow("a11y.yml");
    const step = installStep(wf.jobs?.a11y);
    const run = step?.run ?? "";
    assert(
      /exit\s+1/.test(run),
      "install step must exit non-zero after all attempts fail so a genuine " +
        "install failure is never masked as success",
    );
  },
);
