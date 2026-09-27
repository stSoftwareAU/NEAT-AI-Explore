/**
 * Tests that the accessibility workflow skips its scan when no scanned input
 * changed, while still reporting the required `a11y` check (#652).
 *
 * `a11y` is a required status check on the live Develop and milestone
 * rulesets, so a workflow-level `paths:` filter would leave non-docs PRs stuck
 * at "Expected". Instead the triggers stay unfiltered and a `changes` step
 * decides whether the install/serve/scan steps run. These tests execute that
 * step's script in a throwaway git repository and assert on the `scan` output
 * it writes to `$GITHUB_OUTPUT`.
 */

import { parse as parseYaml } from "@std/yaml";
import { assert, assertEquals } from "./test_helpers.ts";

interface Step {
  id?: string;
  name?: string;
  uses?: string;
  if?: string;
  run?: string;
  with?: Record<string, unknown>;
}

interface Workflow {
  on?: Record<string, { paths?: unknown; "paths-ignore"?: unknown } | null>;
  jobs?: Record<string, { steps?: Step[] }>;
}

const WORKFLOW = new URL("../.github/workflows/a11y.yml", import.meta.url);
const SCAN_IF = "steps.changes.outputs.scan == 'true'";

async function loadWorkflow(): Promise<Workflow> {
  return parseYaml(await Deno.readTextFile(WORKFLOW)) as Workflow;
}

async function loadSteps(): Promise<Step[]> {
  const steps = (await loadWorkflow()).jobs?.a11y?.steps;
  assert(steps && steps.length > 0, "a11y.yml must define a11y job steps");
  return steps;
}

async function changesScript(): Promise<string> {
  const step = (await loadSteps()).find((s) => s.id === "changes");
  assert(step?.run, "a11y.yml must have a `changes` step with a run script");
  return step.run;
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const out = await new Deno.Command("git", {
    args: ["-c", "user.name=t", "-c", "user.email=t@t", ...args],
    cwd,
    stdin: "null",
  }).output();
  assert(
    out.success,
    `git ${args.join(" ")} failed: ${new TextDecoder().decode(out.stderr)}`,
  );
  return new TextDecoder().decode(out.stdout).trim();
}

/** Commits `files` on top of a base commit and runs the `changes` step. */
async function runChanges(
  files: string[],
  base?: (baseSha: string) => string,
): Promise<{ success: boolean; output: string }> {
  const dir = await Deno.makeTempDir();
  try {
    await git(dir, "init", "-q");
    await Deno.writeTextFile(`${dir}/seed.txt`, "seed");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-qm", "base");
    const baseSha = await git(dir, "rev-parse", "HEAD");
    for (const file of files) {
      await Deno.mkdir(`${dir}/${file}`.replace(/\/[^/]+$/, ""), {
        recursive: true,
      });
      await Deno.writeTextFile(`${dir}/${file}`, "changed");
    }
    await git(dir, "add", "-A");
    await git(dir, "commit", "-qm", "change", "--allow-empty");
    const outFile = `${dir}/.gh_output`;
    await Deno.writeTextFile(outFile, "");
    const res = await new Deno.Command("bash", {
      args: ["-e", "-c", await changesScript()],
      cwd: dir,
      stdin: "null",
      env: {
        BASE_SHA: base ? base(baseSha) : baseSha,
        GITHUB_OUTPUT: outFile,
      },
    }).output();
    return {
      success: res.success,
      output: (await Deno.readTextFile(outFile)).trim(),
    };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("a11y.yml has no workflow-level paths filter (#652)", async () => {
  const on = (await loadWorkflow()).on ?? {};
  for (const event of ["pull_request", "push"]) {
    assert(event in on, `a11y.yml must keep its ${event} trigger`);
    assert(
      !on[event]?.paths && !on[event]?.["paths-ignore"],
      `a11y.yml ${event} must not filter paths: \`a11y\` is a required check`,
    );
  }
});

Deno.test("a11y.yml gates every step after `changes` on its output (#652)", async () => {
  const steps = await loadSteps();
  const idx = steps.findIndex((s) => s.id === "changes");
  assert(idx > 0, "`changes` must follow checkout");
  const checkout = steps[idx - 1];
  assert(checkout.uses?.startsWith("actions/checkout@"), "checkout first");
  assertEquals(checkout.with?.["fetch-depth"], 0, "base must be fetched");
  const gated = steps.slice(idx + 1);
  assert(gated.length > 0, "scan steps must follow `changes`");
  for (const step of gated) {
    assertEquals(step.if, SCAN_IF, `${step.name ?? step.uses} must be gated`);
  }
});

for (
  const file of [
    "docs/index.html",
    "docs/shared/app.js",
    "pa11yci.json",
    ".github/workflows/a11y.yml",
  ]
) {
  Deno.test(`a11y changes step scans when '${file}' changes`, async () => {
    const res = await runChanges(["helpers/x.ts", file]);
    assert(res.success, "changes step must succeed");
    assertEquals(res.output, "scan=true");
  });
}

for (
  const file of [
    "helpers/server.ts",
    "scripts/verify_csp.ts",
    "tests/pwa_test.ts",
    "README.md",
    "notdocs/index.html",
    "pa11yci.json.bak",
  ]
) {
  Deno.test(`a11y changes step skips when only '${file}' changes`, async () => {
    const res = await runChanges([file]);
    assert(res.success, "changes step must succeed");
    assertEquals(res.output, "scan=false");
  });
}

Deno.test("a11y changes step skips an empty diff", async () => {
  const res = await runChanges([]);
  assert(res.success, "changes step must succeed");
  assertEquals(res.output, "scan=false");
});

for (
  const [label, base] of [
    ["empty", () => ""],
    ["all-zero (new branch push)", () => "0".repeat(40)],
    ["unreachable", () => "f".repeat(40)],
  ] as const
) {
  Deno.test(`a11y changes step scans when base SHA is ${label}`, async () => {
    const res = await runChanges(["helpers/x.ts"], base);
    assert(res.success, "changes step must succeed");
    assertEquals(res.output, "scan=true");
  });
}
