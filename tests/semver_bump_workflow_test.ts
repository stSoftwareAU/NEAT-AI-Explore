/**
 * Tests for the semver-bump workflow (Issue #217).
 *
 * Validates that `.github/workflows/semver-bump.yml` does not interpolate
 * untrusted `${{ github.* }}` expressions directly into `run:` shell blocks
 * (GH Actions script-injection class). Values must be routed through an
 * `env:` mapping and referenced as `"$VAR"` from shell.
 */

import { parse as parseYaml } from "@std/yaml";
import { assert, assertEquals } from "./test_helpers.ts";

const WORKFLOW_PATH = new URL(
  "../.github/workflows/semver-bump.yml",
  import.meta.url,
);

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
  if?: string;
  id?: string;
}

interface Workflow {
  name?: string;
  on?: Record<string, unknown> | string;
  jobs?: Record<string, {
    "runs-on"?: string;
    steps?: Step[];
  }>;
}

async function loadWorkflow(): Promise<Workflow> {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  return parseYaml(text) as Workflow;
}

async function loadRawText(): Promise<string> {
  return await Deno.readTextFile(WORKFLOW_PATH);
}

Deno.test("semver-bump workflow file exists and parses as YAML", async () => {
  const wf = await loadWorkflow();
  assertEquals(wf.name, "Update Package Version");
});

Deno.test("semver-bump: no run: block interpolates github.base_ref directly", async () => {
  const wf = await loadWorkflow();
  const job = wf.jobs?.["update-version"];
  assert(job, "expected an 'update-version' job");
  const steps = job!.steps ?? [];
  for (const step of steps) {
    if (typeof step.run === "string") {
      assert(
        !/\$\{\{\s*github\.base_ref\s*\}\}/.test(step.run),
        `run: block of step "${
          step.name ?? step.id ?? "unnamed"
        }" must not interpolate github.base_ref directly; route via env:`,
      );
    }
  }
});

Deno.test("semver-bump: no run: block interpolates github.head_ref directly", async () => {
  const wf = await loadWorkflow();
  const job = wf.jobs?.["update-version"];
  assert(job, "expected an 'update-version' job");
  const steps = job!.steps ?? [];
  for (const step of steps) {
    if (typeof step.run === "string") {
      assert(
        !/\$\{\{\s*github\.head_ref\s*\}\}/.test(step.run),
        `run: block of step "${
          step.name ?? step.id ?? "unnamed"
        }" must not interpolate github.head_ref directly; route via env:`,
      );
    }
  }
});

Deno.test("semver-bump: Check Version Update step exposes BASE_REF via env:", async () => {
  const wf = await loadWorkflow();
  const job = wf.jobs?.["update-version"];
  const steps = job?.steps ?? [];
  const step = steps.find((s) => s.id === "check_version");
  assert(step, "expected the 'check_version' step to exist");
  assert(
    step!.env && typeof step!.env.BASE_REF === "string",
    "check_version step must define env.BASE_REF",
  );
  assert(
    step!.env!.BASE_REF.includes("github.base_ref"),
    `env.BASE_REF must source from github.base_ref, got: ${
      step!.env!.BASE_REF
    }`,
  );
});

Deno.test("semver-bump: check_version run block uses $BASE_REF env var", async () => {
  const wf = await loadWorkflow();
  const job = wf.jobs?.["update-version"];
  const steps = job?.steps ?? [];
  const step = steps.find((s) => s.id === "check_version");
  assert(step, "expected the 'check_version' step to exist");
  const run = step!.run ?? "";
  assert(
    run.includes("$BASE_REF") || run.includes("${BASE_REF}"),
    "check_version step must reference BASE_REF via shell variable expansion",
  );
});

Deno.test('semver-bump: no raw \\" backslash-escaped quotes in run blocks', async () => {
  // The original workflow had bash blocks that escaped `"` as `\"` unnecessarily.
  // The fix normalises shell quoting; assert that no `\"` sequences remain in
  // run: blocks (defence-in-depth + readability — Issue #217).
  const text = await loadRawText();
  // Find each run: |  block and inspect it.
  const lines = text.split("\n");
  let inRunBlock = false;
  let runIndent = 0;
  let offendingLine = "";
  let lineNo = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    const indent = line.length - trimmed.length;
    if (inRunBlock) {
      if (line.trim() === "" || indent > runIndent) {
        if (line.includes('\\"')) {
          offendingLine = line;
          lineNo = i + 1;
          break;
        }
        continue;
      } else {
        inRunBlock = false;
      }
    }
    if (/^\s*run:\s*\|/.test(line)) {
      inRunBlock = true;
      runIndent = indent;
    }
  }
  assert(
    offendingLine === "",
    `line ${lineNo} inside a run: block uses backslash-escaped quote (\\"): ${offendingLine}`,
  );
});
