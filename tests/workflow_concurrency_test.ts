/**
 * Tests for the workflow concurrency policy (#258).
 *
 * Every PR-triggered workflow in `.github/workflows/` must declare a
 * workflow-level `concurrency:` block so that superseded runs are cancelled
 * when a contributor pushes new commits to a PR in quick succession. Without
 * this, older runs keep churning the same `deno fmt` / `deno lint` /
 * `deno test` / Semgrep work, wasting runner minutes and confusing the PR
 * Checks panel about "current status".
 *
 * The canonical group key is `${{ github.workflow }}-${{ github.ref }}` with
 * `cancel-in-progress: true`.
 *
 * `deploy.yml` is intentionally exempt — it keys its concurrency on `"pages"`
 * with `cancel-in-progress: false` so Pages deploys serialise correctly.
 */

import { parse as parseYaml } from "@std/yaml";
import { assert, assertEquals } from "./test_helpers.ts";

interface ConcurrencyBlock {
  group?: string;
  "cancel-in-progress"?: boolean;
}

interface Workflow {
  on?: Record<string, unknown> | string | string[];
  concurrency?: ConcurrencyBlock | string;
}

const WORKFLOWS_DIR = new URL("../.github/workflows/", import.meta.url);

// deploy.yml deliberately uses a different concurrency policy
// (group: "pages", cancel-in-progress: false). It serialises Pages
// deploys instead of cancelling them.
const EXEMPT_WORKFLOWS = new Set(["deploy.yml"]);

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

function isPrTriggered(wf: Workflow): boolean {
  const triggers = wf.on;
  if (!triggers) return false;
  if (typeof triggers === "string") return triggers === "pull_request";
  if (Array.isArray(triggers)) return triggers.includes("pull_request");
  return "pull_request" in (triggers as Record<string, unknown>);
}

Deno.test(
  "every PR-triggered workflow declares a concurrency group (#258)",
  async () => {
    const files = await listWorkflowFiles();
    assert(files.length > 0, "expected at least one workflow file");

    const failures: string[] = [];
    let checked = 0;
    for (const file of files) {
      if (EXEMPT_WORKFLOWS.has(file)) continue;
      const wf = await loadWorkflow(file);
      if (!isPrTriggered(wf)) continue;
      checked++;

      const conc = wf.concurrency;
      if (!conc || typeof conc !== "object") {
        failures.push(
          `${file}: missing top-level concurrency block (expected ` +
            `group + cancel-in-progress: true)`,
        );
        continue;
      }
      const group = conc.group ?? "";
      if (
        !group.includes("github.workflow") || !group.includes("github.ref")
      ) {
        failures.push(
          `${file}: concurrency.group must reference both github.workflow ` +
            `and github.ref, got '${group}'`,
        );
      }
      if (conc["cancel-in-progress"] !== true) {
        failures.push(
          `${file}: concurrency.cancel-in-progress must be true, got ` +
            `${conc["cancel-in-progress"]}`,
        );
      }
    }

    assert(
      checked > 0,
      "expected at least one PR-triggered workflow to validate",
    );
    assert(
      failures.length === 0,
      `PR-triggered workflows missing or with invalid concurrency:\n  ${
        failures.join("\n  ")
      }`,
    );
  },
);

Deno.test(
  "deploy.yml keeps its Pages-serialising concurrency policy (#258)",
  async () => {
    const wf = await loadWorkflow("deploy.yml");
    const conc = wf.concurrency;
    assert(
      conc && typeof conc === "object",
      "deploy.yml must declare a concurrency block",
    );
    assertEquals(
      (conc as ConcurrencyBlock).group,
      "pages",
      "deploy.yml concurrency.group must be 'pages'",
    );
    assertEquals(
      (conc as ConcurrencyBlock)["cancel-in-progress"],
      false,
      "deploy.yml must NOT cancel in-progress deploys",
    );
  },
);
