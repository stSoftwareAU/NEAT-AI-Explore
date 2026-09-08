/**
 * Tests for the `actions/checkout` + `denoland/setup-deno` pair policy (#623).
 *
 * Six workflows open with the same two-step preamble: check the repository
 * out, then install Deno. The audit flagged the duplication, and the risk it
 * carries is drift — bumping the `denoland/setup-deno` pin or the requested
 * Deno version in five of six copies leaves one workflow silently running a
 * different toolchain, and nothing in CI notices.
 *
 * The duplication itself cannot be removed. A local composite action
 * (`uses: ./.github/actions/...`) is read from the workspace, so the runner
 * can only resolve it *after* `actions/checkout` has run — the checkout half
 * of the pair can never live inside it. A reusable workflow is called at the
 * job level and runs on its own runner, so it cannot prepare the environment
 * for the calling job's remaining steps either. See
 * `docs/archive/pr-summaries/pr-summary-623.md`.
 *
 * What is achievable is closing the drift gap the duplication creates, in the
 * idiom this repo already uses for `actions/checkout` (#293): the copies must
 * agree, and CI fails when one of them wanders off.
 */

import { assert, assertEquals } from "./test_helpers.ts";
import {
  collectActionRefs,
  listWorkflowFiles,
  loadWorkflow,
  setupDenoSteps,
} from "./workflow_helpers.ts";

const SETUP_DENO = "denoland/setup-deno";

Deno.test("workflows install Deno via `denoland/setup-deno` (#623)", async () => {
  const refs = await collectActionRefs(SETUP_DENO);
  assert(
    refs.length > 0,
    `expected at least one ${SETUP_DENO} reference across the workflows`,
  );
});

Deno.test("all `denoland/setup-deno` references resolve to one SHA (#623)", async () => {
  const refs = await collectActionRefs(SETUP_DENO);
  const unique = [...new Set(refs.map(([, sha]) => sha))];
  assertEquals(
    unique.length,
    1,
    `Expected a single pinned ${SETUP_DENO} SHA across all workflows, found ${unique.length}:\n  ${
      refs.map(([file, sha]) => `${file}: ${sha}`).join("\n  ")
    }`,
  );
});

Deno.test("every `denoland/setup-deno` step requests the same Deno version (#623)", async () => {
  const versions: Array<[string, string]> = [];
  for (const file of await listWorkflowFiles()) {
    const wf = await loadWorkflow(file);
    for (const [jobName, job] of Object.entries(wf.jobs ?? {})) {
      for (const step of setupDenoSteps(job)) {
        const version = step.with?.["deno-version"];
        assert(
          typeof version === "string" && version.length > 0,
          `${file} / ${jobName}: ${SETUP_DENO} must set ` +
            "`with.deno-version` so the toolchain is not left to the " +
            "action's own default",
        );
        versions.push([`${file}: ${jobName}`, version as string]);
      }
    }
  }
  assert(versions.length > 0, `expected at least one ${SETUP_DENO} step`);

  const unique = [...new Set(versions.map(([, v]) => v))];
  assertEquals(
    unique.length,
    1,
    `Expected one requested Deno version across all workflows, found ${unique.length}:\n  ${
      versions.map(([where, v]) => `${where}: ${v}`).join("\n  ")
    }`,
  );
});

Deno.test("every `denoland/setup-deno` step is preceded by a checkout in its job (#623)", async () => {
  const violations: string[] = [];
  for (const file of await listWorkflowFiles()) {
    const wf = await loadWorkflow(file);
    for (const [jobName, job] of Object.entries(wf.jobs ?? {})) {
      const steps = job?.steps ?? [];
      let checkedOut = false;
      for (const step of steps) {
        const uses = typeof step.uses === "string" ? step.uses : "";
        if (uses.startsWith("actions/checkout@")) checkedOut = true;
        if (uses.startsWith(`${SETUP_DENO}@`) && !checkedOut) {
          violations.push(`${file}: ${jobName}`);
        }
      }
    }
  }
  assertEquals(
    violations.length,
    0,
    "Every job that installs Deno must check the repository out first — " +
      `the pair is copied together and must stay together:\n  ${
        violations.join("\n  ")
      }`,
  );
});
