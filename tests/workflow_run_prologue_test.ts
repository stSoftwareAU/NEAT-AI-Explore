/**
 * Behaviour tests for the `set -Eeuo pipefail` prologue on the two multi-line
 * `run:` blocks flagged by #557.
 *
 * GitHub Actions runs `run:` scripts under `bash -e {0}`, so `-e` applies but
 * `pipefail`, `-u`, and `-E` do not. Without `pipefail` a failing `wget` in
 * `wget … | sudo gpg --dearmor …` is masked by the exit status of the last
 * command in the pipeline, and the fault only resurfaces later as a confusing
 * apt signature error — a silent failure.
 *
 * Rather than grepping the YAML for the literal prologue, these tests extract
 * the leading `set` lines of each step and execute them under the same
 * `bash -e` invocation GitHub uses, then assert on the shell options that are
 * actually in effect. A prologue that does not really enable pipefail/nounset
 * /errtrace fails here regardless of how it is spelt.
 */

import { parse as parseYaml } from "@std/yaml";
import { assert, assertEquals } from "./test_helpers.ts";

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
  const text = await Deno.readTextFile(new URL(name, WORKFLOWS_DIR));
  return parseYaml(text) as Workflow;
}

function findStep(
  wf: Workflow,
  job: string,
  stepName: string,
): WorkflowStep {
  const step = (wf.jobs?.[job]?.steps ?? []).find((s) => s.name === stepName);
  assert(step !== undefined, `job '${job}' must have a step '${stepName}'`);
  return step!;
}

/** The leading `set …` lines of a run block, before the first real command. */
function prologueOf(run: string): string {
  const lines: string[] = [];
  for (const raw of run.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (!line.startsWith("set ")) break;
    lines.push(line);
  }
  return lines.join("\n");
}

/**
 * Execute `prologue` the way GitHub Actions executes a `run:` block — under
 * `bash -e` — and report the shell options it leaves enabled.
 */
async function effectiveOptions(prologue: string): Promise<Set<string>> {
  const script = `${prologue}\nset -o`;
  const { code, stdout, stderr } = await new Deno.Command("bash", {
    args: ["-e", "-c", script],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(
    code,
    0,
    `prologue failed to execute: ${new TextDecoder().decode(stderr)}`,
  );
  const enabled = new Set<string>();
  for (const line of new TextDecoder().decode(stdout).split("\n")) {
    const [name, state] = line.trim().split(/\s+/);
    if (state === "on") enabled.add(name);
  }
  return enabled;
}

const REQUIRED = ["errexit", "errtrace", "nounset", "pipefail"];

async function assertPrologue(
  file: string,
  job: string,
  stepName: string,
): Promise<void> {
  const step = findStep(await loadWorkflow(file), job, stepName);
  const run = step.run ?? "";
  assert(
    run.includes("\n"),
    `${file}: step '${stepName}' is expected to be a multi-line run block`,
  );
  const enabled = await effectiveOptions(prologueOf(run));
  const missing = REQUIRED.filter((opt) => !enabled.has(opt));
  assertEquals(
    missing.join(", "),
    "",
    `${file}: step '${stepName}' leaves shell options off under 'bash -e': ` +
      `${missing.join(", ")} — a failing command in a pipeline would be ` +
      `masked as success`,
  );
}

Deno.test(
  "a11y 'Install system Chrome' enables pipefail/nounset/errtrace (#557)",
  async () => {
    await assertPrologue("a11y.yml", "a11y", "Install system Chrome");
  },
);

Deno.test(
  "semver-bump 'Commit Version Update' enables pipefail/nounset/errtrace (#557)",
  async () => {
    await assertPrologue(
      "semver-bump.yml",
      "update-version",
      "Commit Version Update",
    );
  },
);
