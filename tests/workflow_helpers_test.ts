/**
 * Tests for the shared workflow policy scaffolding (#588).
 *
 * The consolidated policy suites all parse workflows through these helpers, so
 * a silent regression here (an empty file list, a swallowed read error, a
 * prefix that matches the wrong action) would quietly disarm every gate.
 */

import { assert, assertEquals } from "./test_helpers.ts";
import {
  checkoutSteps,
  collectActionRefs,
  jobsWithCheckout,
  listWorkflowFiles,
  loadWorkflow,
  type WorkflowJob,
} from "./workflow_helpers.ts";

Deno.test("listWorkflowFiles returns sorted YAML workflow files", async () => {
  const files = await listWorkflowFiles();
  assert(files.length > 0, "expected at least one workflow file");
  assert(
    files.every((f) => f.endsWith(".yml") || f.endsWith(".yaml")),
    `expected only YAML files, got ${JSON.stringify(files)}`,
  );
  assertEquals(
    JSON.stringify(files),
    JSON.stringify([...files].sort()),
    "expected the listing to be sorted",
  );
});

Deno.test("loadWorkflow parses a real workflow into jobs", async () => {
  const wf = await loadWorkflow("deno-quality.yml");
  assert(wf.jobs !== undefined, "expected deno-quality.yml to declare jobs");
  assert(
    Object.keys(wf.jobs).length > 0,
    "expected deno-quality.yml to declare at least one job",
  );
});

Deno.test("loadWorkflow rejects for a missing workflow", async () => {
  let threw = false;
  try {
    await loadWorkflow("no-such-workflow.yml");
  } catch {
    threw = true;
  }
  assert(threw, "expected loadWorkflow to reject for a missing file");
});

Deno.test("checkoutSteps selects only actions/checkout steps", () => {
  const job: WorkflowJob = {
    steps: [
      { uses: "actions/checkout@abc", with: { "persist-credentials": false } },
      { uses: "actions/setup-node@def" },
      { run: "echo hi" },
      { uses: "actions/checkout@abc" },
    ],
  };
  const steps = checkoutSteps(job);
  assertEquals(steps.length, 2);
  assertEquals(steps[0].with?.["persist-credentials"], false);
});

Deno.test("checkoutSteps handles missing jobs and empty step lists", () => {
  assertEquals(checkoutSteps(undefined).length, 0);
  assertEquals(checkoutSteps({}).length, 0);
  assertEquals(checkoutSteps({ steps: [] }).length, 0);
});

Deno.test("jobsWithCheckout names only jobs that check out", () => {
  const names = jobsWithCheckout({
    jobs: {
      build: { steps: [{ uses: "actions/checkout@abc" }] },
      notify: { steps: [{ run: "echo done" }] },
    },
  });
  assertEquals(JSON.stringify(names), JSON.stringify(["build"]));
});

Deno.test("collectActionRefs anchors on the action name", async () => {
  const uploadArtifact = await collectActionRefs("actions/upload-artifact");
  const uploadPages = await collectActionRefs("actions/upload-pages-artifact");
  assert(uploadArtifact.length > 0, "expected upload-artifact references");
  assert(uploadPages.length > 0, "expected upload-pages-artifact references");
  const shas = new Set(uploadArtifact.map(([, sha]) => sha));
  for (const [, sha] of uploadPages) {
    assert(
      !shas.has(sha),
      "upload-pages-artifact refs must not leak into upload-artifact refs",
    );
  }
});

Deno.test("collectActionRefs returns nothing for an unused action", async () => {
  assertEquals((await collectActionRefs("acme/not-used")).length, 0);
});
