/**
 * Tests for the Accessibility (a11y) CI workflow (#206).
 *
 * Validates that .github/workflows/a11y.yml is present, parseable, and
 * configured to run pa11y-ci against the static UI shipped in `docs/`. This
 * gives the Quality Gate automated WCAG coverage for the Explorer, Graph and
 * Starfield viewers that get deployed to GitHub Pages.
 */

import { parse as parseYaml } from "@std/yaml";
import { assert, assertEquals } from "./test_helpers.ts";

const WORKFLOW_PATH = new URL(
  "../.github/workflows/a11y.yml",
  import.meta.url,
);
const CONFIG_PATH = new URL("../pa11yci.json", import.meta.url);

interface WorkflowStep {
  uses?: string;
  name?: string;
  run?: string;
  with?: Record<string, unknown>;
  if?: string;
  id?: string;
}

interface A11yWorkflow {
  name?: string;
  on?: Record<string, unknown> | string;
  permissions?: Record<string, string>;
  jobs?: Record<string, {
    "runs-on"?: string;
    steps?: WorkflowStep[];
  }>;
}

async function loadWorkflow(): Promise<A11yWorkflow> {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  return parseYaml(text) as A11yWorkflow;
}

Deno.test("a11y workflow file exists", async () => {
  const stat = await Deno.stat(WORKFLOW_PATH);
  assert(stat.isFile, "expected a11y.yml to be a regular file");
});

Deno.test("a11y workflow is valid YAML and named Accessibility", async () => {
  const wf = await loadWorkflow();
  assertEquals(wf.name, "Accessibility");
});

Deno.test("a11y workflow triggers on pull_request", async () => {
  const wf = await loadWorkflow();
  const triggers = wf.on as Record<string, unknown> | undefined;
  assert(
    triggers && typeof triggers === "object",
    "workflow must declare triggers",
  );
  assert(
    "pull_request" in triggers,
    "workflow must trigger on pull_request events",
  );
});

Deno.test("a11y workflow uses minimal contents:read permissions", async () => {
  const wf = await loadWorkflow();
  assertEquals(wf.permissions?.contents, "read");
});

Deno.test("a11y workflow checks out, sets up Node, installs and runs pa11y-ci", async () => {
  const wf = await loadWorkflow();
  const job = wf.jobs?.a11y;
  assert(job, "expected an 'a11y' job");
  assertEquals(job!["runs-on"], "ubuntu-latest");

  const steps = job!.steps ?? [];
  const checkout = steps.find((s) =>
    (s.uses ?? "").startsWith("actions/checkout@")
  );
  assert(checkout, "workflow must check out the repository");

  const setupNode = steps.find((s) =>
    (s.uses ?? "").startsWith("actions/setup-node@")
  );
  assert(setupNode, "workflow must set up Node.js");

  const install = steps.find((s) => (s.run ?? "").includes("pa11y-ci"));
  assert(install, "workflow must install or invoke pa11y-ci");

  const runStep = steps.find((s) =>
    (s.run ?? "").includes("pa11y-ci") &&
    !(s.run ?? "").includes("npm install")
  );
  assert(runStep, "workflow must invoke pa11y-ci against the served pages");
});

Deno.test("a11y workflow pins third-party actions to commit SHAs", async () => {
  const wf = await loadWorkflow();
  const job = wf.jobs?.a11y;
  const steps = job?.steps ?? [];

  const thirdPartyUses = steps
    .map((s) => s.uses ?? "")
    .filter((u) => u.length > 0);

  assert(thirdPartyUses.length > 0, "workflow must use at least one action");

  for (const uses of thirdPartyUses) {
    const ref = uses.split("@")[1] ?? "";
    assert(
      /^[0-9a-f]{40}$/.test(ref),
      `action ${uses} must be pinned to a 40-char commit SHA, got '${ref}'`,
    );
  }
});

Deno.test("a11y workflow http-server readiness loop uses strict bash flags (#260)", async () => {
  const wf = await loadWorkflow();
  const job = wf.jobs?.a11y;
  const steps = job?.steps ?? [];

  const serveStep = steps.find((s) =>
    (s.run ?? "").includes("http-server") &&
    (s.run ?? "").includes("127.0.0.1:8080")
  );
  assert(
    serveStep,
    "workflow must declare a step that backgrounds http-server on 127.0.0.1:8080",
  );

  const run = serveStep!.run ?? "";
  // Match the semver-bump.yml convention (`set -Eeuo pipefail`) but accept the
  // suggested `set -euo pipefail` too — both close the failure modes the audit
  // flagged (typo'd ${VAR} expansions, swallowed pipeline failures).
  assert(
    /^\s*set\s+-E?euo\s+pipefail\b/m.test(run),
    "Serve docs/ step must begin its bash with `set -euo pipefail` (or `-Eeuo`) before backgrounding http-server",
  );
});

Deno.test("pa11y-ci config exists and is valid JSON", async () => {
  const text = await Deno.readTextFile(CONFIG_PATH);
  const parsed = JSON.parse(text);
  assert(
    parsed && typeof parsed === "object",
    "pa11y-ci config must be a JSON object",
  );
});

Deno.test("pa11y-ci config covers Explorer, Graph and Starfield pages", async () => {
  const text = await Deno.readTextFile(CONFIG_PATH);
  const parsed = JSON.parse(text) as { urls?: unknown[] };
  assert(Array.isArray(parsed.urls), "config must declare a 'urls' array");

  const urls = parsed.urls!.map((u) =>
    typeof u === "string" ? u : (u as { url?: string }).url ?? ""
  );

  const joined = urls.join(" ");
  assert(
    joined.includes("/index.html") || urls.some((u) => u.endsWith("/")),
    "config must cover the Explorer landing page",
  );
  assert(
    urls.some((u) => u.includes("/graph/")),
    "config must cover the Graph viewer page",
  );
  assert(
    urls.some((u) => u.includes("/starfield/")),
    "config must cover the Starfield viewer page",
  );
});

Deno.test("pa11y-ci config declares a WCAG standard", async () => {
  const text = await Deno.readTextFile(CONFIG_PATH);
  const parsed = JSON.parse(text) as {
    defaults?: { standard?: string };
  };
  const standard = parsed.defaults?.standard ?? "";
  assert(
    /^WCAG2(A|AA|AAA)$/.test(standard),
    `config must set defaults.standard to a WCAG level, got '${standard}'`,
  );
});
