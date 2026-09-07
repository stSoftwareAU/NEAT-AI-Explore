/**
 * Tests for the remote-script supply-chain policy on workflows (#618).
 *
 * `.github/workflows/actionlint.yml` fetched actionlint's install script from
 * `raw.githubusercontent.com/rhysd/actionlint/v1.7.12/...` — a *tag*, not a
 * commit — and piped it straight into `bash`. A tag can be force-moved by a
 * compromised upstream account to point at different content, so the runner
 * would fetch and execute whatever the tag resolved to at that moment, with
 * no diff review and no integrity check. Every third-party `uses:` in this
 * repo is SHA-pinned for exactly that reason (see
 * `workflow_action_sha_pinning_test.ts`); a fetched-and-executed script is the
 * same trust decision and gets the same discipline.
 *
 * Two policies, checked across every workflow rather than just the one that
 * prompted the issue:
 *
 * 1. Every `raw.githubusercontent.com` URL resolves a 40-character commit SHA,
 *    never a branch or tag.
 * 2. Every downloaded script that is then executed has its SHA-256 verified
 *    against a value pinned in this repo before it runs — and no step pipes a
 *    download straight into a shell, which cannot be verified at all.
 */

import {
  listWorkflowFiles,
  loadWorkflow,
  type Workflow,
  type WorkflowStep,
} from "./workflow_helpers.ts";
import { assert } from "./test_helpers.ts";

const SHA_PATTERN = /^[0-9a-f]{40}$/;

/**
 * `https://raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>` — capture
 * the ref segment so it can be held to the same 40-char SHA rule as `uses:`.
 */
const RAW_URL_PATTERN =
  /raw\.githubusercontent\.com\/[^/\s"']+\/[^/\s"']+\/([^/\s"']+)\/[^\s"']+/g;

/** Every string leaf in a parsed workflow document (comments excluded). */
function collectStrings(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string") {
    out.push(node);
  } else if (Array.isArray(node)) {
    for (const item of node) collectStrings(item, out);
  } else if (node && typeof node === "object") {
    for (const value of Object.values(node)) collectStrings(value, out);
  }
  return out;
}

function steps(wf: Workflow): WorkflowStep[] {
  return Object.values(wf.jobs ?? {}).flatMap((job) => job?.steps ?? []);
}

/** Local files a `curl`/`wget` in this script writes to disk. */
function downloadedFiles(script: string): string[] {
  const names = new Set<string>();
  for (const match of script.matchAll(/\bcurl\b[^\n]*?\s-o\s+([^\s"']+)/g)) {
    names.add(match[1]);
  }
  for (const match of script.matchAll(/\bwget\b[^\n]*?\s-O\s+([^\s"']+)/g)) {
    names.add(match[1]);
  }
  return [...names];
}

/** True when `script` runs `file` through a shell interpreter. */
function isExecutedByShell(script: string, file: string): boolean {
  const quoted = file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b(?:ba)?sh\\s+(?:-[^\\s]+\\s+)*["']?${quoted}`)
    .test(script);
}

/** True when `script` pipes a download straight into a shell. */
function pipesDownloadToShell(script: string): boolean {
  return /\b(?:curl|wget)\b[^\n|]*\|[^\n|]*\b(?:ba)?sh\b/.test(script);
}

Deno.test("every raw.githubusercontent.com URL in a workflow is pinned to a 40-char commit SHA (#618)", async () => {
  const files = await listWorkflowFiles();
  assert(files.length > 0, "expected at least one workflow file");

  const failures: string[] = [];
  for (const file of files) {
    const wf = await loadWorkflow(file);
    for (const text of collectStrings(wf)) {
      for (const [url, ref] of text.matchAll(RAW_URL_PATTERN)) {
        if (!SHA_PATTERN.test(ref)) {
          failures.push(
            `${file}: '${url}' — ref '${ref}' is not a 40-char commit SHA`,
          );
        }
      }
    }
  }

  assert(
    failures.length === 0,
    `Unpinned raw.githubusercontent.com references found (a tag or branch can be moved to new content):\n  ${
      failures.join("\n  ")
    }`,
  );
});

Deno.test("no workflow step pipes a download straight into a shell (#618)", async () => {
  const failures: string[] = [];
  for (const file of await listWorkflowFiles()) {
    const wf = await loadWorkflow(file);
    for (const step of steps(wf)) {
      if (typeof step.run !== "string") continue;
      if (pipesDownloadToShell(step.run)) {
        failures.push(`${file}: step '${step.name ?? "(unnamed)"}'`);
      }
    }
  }

  assert(
    failures.length === 0,
    `Steps piping a download into a shell (the content can never be verified before it executes):\n  ${
      failures.join("\n  ")
    }`,
  );
});

Deno.test("every downloaded script a workflow executes is checksum-verified first (#618)", async () => {
  const failures: string[] = [];
  for (const file of await listWorkflowFiles()) {
    const wf = await loadWorkflow(file);
    for (const step of steps(wf)) {
      const script = step.run;
      if (typeof script !== "string") continue;
      const executed = downloadedFiles(script).filter((name) =>
        isExecutedByShell(script, name)
      );
      if (executed.length === 0) continue;
      if (!/\bsha256sum\b[^\n]*\s-c\b/.test(script)) {
        failures.push(
          `${file}: step '${step.name ?? "(unnamed)"}' executes ${
            executed.join(", ")
          } without a 'sha256sum -c' check`,
        );
      }
    }
  }

  assert(
    failures.length === 0,
    `Downloaded scripts executed without verifying their SHA-256 against a pinned value:\n  ${
      failures.join("\n  ")
    }`,
  );
});

Deno.test("the actionlint install step pins its script URL and verifies its checksum (#618)", async () => {
  const wf = await loadWorkflow("actionlint.yml");
  const install = steps(wf).find((step) =>
    typeof step.run === "string" && /download-actionlint\.bash/.test(step.run)
  );
  assert(
    install !== undefined,
    "actionlint.yml must still install actionlint from the upstream script",
  );

  const env = (install.env ?? {}) as Record<string, unknown>;
  const url = String(env.SCRIPT_URL ?? "");
  const ref = [...url.matchAll(RAW_URL_PATTERN)][0]?.[1] ?? "";
  assert(
    SHA_PATTERN.test(ref),
    `SCRIPT_URL must resolve a 40-char commit SHA, got '${ref}'`,
  );

  const expected = String(env.SCRIPT_SHA256 ?? "");
  assert(
    /^[0-9a-f]{64}$/.test(expected),
    `SCRIPT_SHA256 must pin a 64-char SHA-256 digest, got '${expected}'`,
  );
  assert(
    String(install.run).includes(expected) ||
      /\$\{?SCRIPT_SHA256\b/.test(String(install.run)),
    "the install step must feed SCRIPT_SHA256 into its verification",
  );
});
