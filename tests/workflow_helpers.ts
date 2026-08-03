/**
 * Shared scaffolding for the workflow policy tests (#588).
 *
 * The per-workflow policy suites each re-declared the same YAML interfaces,
 * directory listing and loader — 27 near-identical copies. They live here
 * once, so tightening a policy or changing the parsed shape is a single edit.
 */

import { parse as parseYaml } from "@std/yaml";

export interface WorkflowStep {
  uses?: string;
  name?: string;
  run?: string;
  with?: Record<string, unknown>;
}

export interface WorkflowJob {
  steps?: WorkflowStep[];
}

export interface PullRequestTrigger {
  branches?: string[];
}

export interface WorkflowTriggers {
  pull_request?: PullRequestTrigger | null;
}

export interface Workflow {
  on?: WorkflowTriggers | string | string[];
  jobs?: Record<string, WorkflowJob>;
}

export const WORKFLOWS_DIR = new URL("../.github/workflows/", import.meta.url);

/** Every `.yml`/`.yaml` file in `.github/workflows/`, sorted by name. */
export async function listWorkflowFiles(): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(WORKFLOWS_DIR)) {
    if (!entry.isFile) continue;
    if (!entry.name.endsWith(".yml") && !entry.name.endsWith(".yaml")) continue;
    files.push(entry.name);
  }
  files.sort();
  return files;
}

/**
 * Parse a workflow file from `.github/workflows/`.
 *
 * Rejects when the file is missing or is not parseable YAML — a policy test
 * naming a workflow that no longer exists must fail loudly, not silently
 * pass over an empty document.
 */
export async function loadWorkflow(name: string): Promise<Workflow> {
  const url = new URL(name, WORKFLOWS_DIR);
  const text = await Deno.readTextFile(url);
  return parseYaml(text) as Workflow;
}

/** Return every `actions/checkout` step in the given job. */
export function checkoutSteps(job: WorkflowJob | undefined): WorkflowStep[] {
  return (job?.steps ?? []).filter((step) =>
    typeof step.uses === "string" &&
    step.uses.startsWith("actions/checkout@")
  );
}

/**
 * Collect `[file, sha]` for every `<action>@<sha>` reference across all
 * workflows.
 *
 * The action name is anchored with a trailing `@`, so `actions/upload-artifact`
 * never matches the distinct `actions/upload-pages-artifact`.
 */
export async function collectActionRefs(
  action: string,
): Promise<Array<[string, string]>> {
  const prefix = `${action}@`;
  const refs: Array<[string, string]> = [];
  for (const file of await listWorkflowFiles()) {
    const wf = await loadWorkflow(file);
    for (const job of Object.values(wf.jobs ?? {})) {
      for (const step of job?.steps ?? []) {
        const uses = step.uses;
        if (typeof uses === "string" && uses.startsWith(prefix)) {
          refs.push([file, uses.split("@")[1] ?? ""]);
        }
      }
    }
  }
  return refs;
}

/** Jobs in `wf` that contain at least one `actions/checkout` step. */
export function jobsWithCheckout(wf: Workflow): string[] {
  return Object.entries(wf.jobs ?? {})
    .filter(([, job]) => checkoutSteps(job).length > 0)
    .map(([name]) => name);
}
