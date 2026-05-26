/**
 * Tests for the workflow job timeout policy (#257).
 *
 * Every job in every `.github/workflows/*.yml` file must declare an explicit
 * `timeout-minutes:` cap so a wedged step cannot hold a runner for the
 * GitHub default of 360 minutes (6 hours). An explicit per-job cap surfaces
 * hangs as fast failures and frees runner capacity.
 *
 * The cap must be a positive integer and must not exceed 60 minutes — none
 * of the jobs in this repository legitimately need more time, and the
 * weekly upgrade workflow is the upper bound at 30 minutes.
 */

import { parse as parseYaml } from "@std/yaml";
import { assert } from "./test_helpers.ts";

interface WorkflowJob {
  "timeout-minutes"?: number;
}

interface Workflow {
  jobs?: Record<string, WorkflowJob>;
}

const WORKFLOWS_DIR = new URL("../.github/workflows/", import.meta.url);
const MAX_TIMEOUT_MINUTES = 60;

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

Deno.test("every workflow job declares timeout-minutes (#257)", async () => {
  const files = await listWorkflowFiles();
  assert(files.length > 0, "expected at least one workflow file");

  const failures: string[] = [];
  for (const file of files) {
    const wf = await loadWorkflow(file);
    const jobs = wf.jobs ?? {};
    for (const [jobName, job] of Object.entries(jobs)) {
      const timeout = job?.["timeout-minutes"];
      if (typeof timeout !== "number") {
        failures.push(`${file}: job '${jobName}' is missing timeout-minutes`);
        continue;
      }
      if (!Number.isInteger(timeout) || timeout <= 0) {
        failures.push(
          `${file}: job '${jobName}' has invalid timeout-minutes: ${timeout}`,
        );
        continue;
      }
      if (timeout > MAX_TIMEOUT_MINUTES) {
        failures.push(
          `${file}: job '${jobName}' timeout-minutes (${timeout}) exceeds cap ` +
            `of ${MAX_TIMEOUT_MINUTES}`,
        );
      }
    }
  }

  assert(
    failures.length === 0,
    `Workflow jobs missing or with invalid timeout-minutes:\n  ${
      failures.join("\n  ")
    }`,
  );
});
