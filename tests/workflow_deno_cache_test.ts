/**
 * Tests for Deno dependency caching in CI (#653).
 *
 * Without a cache every workflow run re-downloads the whole dependency graph.
 * `denoland/setup-deno`'s built-in `cache: true` caches `DENO_DIR` under a
 * primary key ending in the hash of `deno.lock`, and restores from the
 * `deno-cache-<os>-<arch>` prefix on a miss so PR runs start warm. Keying
 * strictly on the lockfile hash is what keeps the cache from going stale, so
 * a `cache-hash` override is refused.
 */
import { assert, assertEquals } from "./test_helpers.ts";
import {
  listWorkflowFiles,
  loadWorkflow,
  setupDenoSteps,
  type WorkflowStep,
} from "./workflow_helpers.ts";

interface Located {
  where: string;
  step: WorkflowStep;
}

async function allSetupDenoSteps(): Promise<Located[]> {
  const found: Located[] = [];
  for (const file of await listWorkflowFiles()) {
    const wf = await loadWorkflow(file);
    for (const [jobName, job] of Object.entries(wf.jobs ?? {})) {
      for (const step of setupDenoSteps(job)) {
        found.push({ where: `${file} → ${jobName}`, step });
      }
    }
  }
  return found;
}

/** YAML may yield the boolean or the string form; both enable the cache. */
function cacheEnabled(step: WorkflowStep): boolean {
  const value = step.with?.["cache"];
  return value === true || value === "true";
}

Deno.test("cacheEnabled - accepts boolean and string true only", () => {
  assert(cacheEnabled({ with: { cache: true } }));
  assert(cacheEnabled({ with: { cache: "true" } }));
  assert(!cacheEnabled({ with: { cache: false } }));
  assert(!cacheEnabled({ with: { cache: "false" } }));
  assert(!cacheEnabled({ with: {} }));
  assert(!cacheEnabled({}));
});

Deno.test("workflows - every setup-deno step is present to check", async () => {
  // Guard against the suite passing vacuously if the steps vanish.
  const steps = await allSetupDenoSteps();
  assert(
    steps.length >= 6,
    `expected at least 6 setup-deno steps, found ${steps.length}`,
  );
});

Deno.test("workflows - every setup-deno step enables the Deno cache", async () => {
  const uncached = (await allSetupDenoSteps())
    .filter(({ step }) => !cacheEnabled(step))
    .map(({ where }) => where);
  assertEquals(
    uncached.length,
    0,
    `setup-deno without \`cache: true\`: ${uncached.join(", ")}`,
  );
});

Deno.test("workflows - the Deno cache is keyed strictly on deno.lock", async () => {
  const overridden = (await allSetupDenoSteps())
    .filter(({ step }) => step.with?.["cache-hash"] !== undefined)
    .map(({ where }) => where);
  assertEquals(
    overridden.length,
    0,
    `setup-deno overrides \`cache-hash\`: ${overridden.join(", ")}`,
  );
});
