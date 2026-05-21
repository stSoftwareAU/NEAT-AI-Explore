/**
 * Tests for the workflow action SHA pinning policy (#190).
 *
 * Every `uses:` reference in `.github/workflows/*.yml` must be pinned to a
 * 40-character commit SHA. Mutable tag references (e.g. `@v4`, `@v7`,
 * `@v4.1.1`) can be retagged by a compromised maintainer to point at a
 * malicious commit — the canonical supply-chain attack vector for GitHub
 * Actions. Pinning to a SHA forecloses that path.
 *
 * The human-readable tag should be kept as a YAML comment immediately above
 * the `uses:` line so dependabot/renovate can still propose upgrades and
 * humans can read what version is in use at a glance.
 */

import { parse as parseYaml } from "@std/yaml";
import { assert } from "./test_helpers.ts";

interface WorkflowStep {
  uses?: string;
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
const SHA_PATTERN = /^[0-9a-f]{40}$/;

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

function collectUses(wf: Workflow): string[] {
  const out: string[] = [];
  for (const job of Object.values(wf.jobs ?? {})) {
    for (const step of job?.steps ?? []) {
      if (typeof step.uses === "string" && step.uses.length > 0) {
        out.push(step.uses);
      }
    }
  }
  return out;
}

Deno.test("every workflow pins every action `uses:` to a 40-char commit SHA (#190)", async () => {
  const files = await listWorkflowFiles();
  assert(files.length > 0, "expected at least one workflow file");

  const failures: string[] = [];
  for (const file of files) {
    const wf = await loadWorkflow(file);
    for (const uses of collectUses(wf)) {
      const ref = uses.split("@")[1] ?? "";
      if (!SHA_PATTERN.test(ref)) {
        failures.push(`${file}: '${uses}' — ref '${ref}' is not a 40-char SHA`);
      }
    }
  }

  assert(
    failures.length === 0,
    `Unpinned actions found (must use 40-char commit SHA):\n  ${
      failures.join("\n  ")
    }`,
  );
});

Deno.test("workflows that pin to a SHA also include the human-readable tag in a comment (#190)", async () => {
  // The comment is dropped during YAML parsing, so we inspect the raw text.
  // Each SHA-pinned `uses:` line should have a comment on the previous
  // non-blank line that names the version (e.g. `# actions/checkout@v4.2.2`).
  const files = await listWorkflowFiles();
  const failures: string[] = [];

  for (const file of files) {
    const url = new URL(file, WORKFLOWS_DIR);
    const text = await Deno.readTextFile(url);
    const lines = text.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/uses:\s*([^\s#]+@[0-9a-f]{40})/);
      if (!m) continue;
      // Walk back through any preceding YAML comment lines (and optional
      // intervening `- name:` / blank lines for steps that label themselves)
      // and require at least one of those comments to name the action
      // repository so reviewers and dependabot can read the human version.
      const actionRepo = m[1].split("@")[0];
      let mentionsRepo = false;
      for (let j = i - 1; j >= 0; j--) {
        const trimmed = lines[j].trim();
        if (trimmed === "") continue;
        // Skip the `- name:` line that often sits between the comment and
        // the `uses:` line.
        if (trimmed.startsWith("- name:") || trimmed.startsWith("name:")) {
          continue;
        }
        if (!trimmed.startsWith("#")) break;
        if (trimmed.includes(actionRepo)) {
          mentionsRepo = true;
          break;
        }
      }
      if (!mentionsRepo) {
        failures.push(
          `${file}:${i + 1}: '${m[1]}' is SHA-pinned but the preceding ` +
            `comment block does not name '${actionRepo}@<tag>'`,
        );
      }
    }
  }

  assert(
    failures.length === 0,
    `Missing version-tag comments next to SHA pins:\n  ${
      failures.join("\n  ")
    }`,
  );
});
