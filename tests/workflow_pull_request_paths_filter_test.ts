/**
 * No workflow may filter its `pull_request` trigger by path (#658, #678).
 *
 * A required status check whose workflow GitHub skips never reports, so the PR
 * waits on "Expected" forever. The live rulesets are the only record of which
 * checks are required, and they change often, so this test does not try to
 * know: any workflow that runs on pull requests may become required, so none
 * may set a workflow-level `paths:` or `paths-ignore:` filter on that trigger.
 * A workflow that only needs to act on some files skips the work inside the
 * job instead, as `a11y.yml` does (#652). Filters on other triggers (for
 * example `deploy.yml`'s `push` filter) are fine.
 */

import { parse as parseYaml } from "@std/yaml";
import { assert } from "./test_helpers.ts";
import { listWorkflowFiles, WORKFLOWS_DIR } from "./workflow_helpers.ts";

type Trigger = { paths?: unknown; "paths-ignore"?: unknown } | null;

Deno.test("no pull_request trigger sets a paths or paths-ignore filter (#678)", async () => {
  const files = await listWorkflowFiles();
  assert(files.length > 0, "expected workflows in .github/workflows/");
  for (const file of files) {
    const wf = parseYaml(
      await Deno.readTextFile(new URL(file, WORKFLOWS_DIR)),
    ) as { on?: Record<string, Trigger> | string | string[] };
    if (!wf.on || typeof wf.on === "string" || Array.isArray(wf.on)) continue;
    for (const event of ["pull_request", "pull_request_target"] as const) {
      const trigger = wf.on[event];
      for (const key of ["paths", "paths-ignore"] as const) {
        assert(
          trigger?.[key] === undefined,
          `${file}: its ${event} trigger sets '${key}'. If this check is ` +
            `ever required, a skipped run never reports and the PR cannot ` +
            `merge; skip the work inside the job instead`,
        );
      }
    }
  }
});
