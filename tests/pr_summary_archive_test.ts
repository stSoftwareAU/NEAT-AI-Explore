/**
 * Enforces that PR-summary documents live under `docs/archive/` and never
 * directly in the `docs/` root.
 *
 * Background: `docs/` is both the documentation root and the GitHub Pages
 * publish root. Mixing site assets with ever-growing PR-summary artefacts
 * makes the directory hard to navigate and contradicts the repo bucket
 * guide. The convention is established by `docs/archive/pr-summary-*.md`;
 * this test enforces it for every newly-added summary too.
 *
 * See Issue #208.
 */

import { assert, assertEquals } from "./test_helpers.ts";

function repoRoot(): string {
  const url = new URL(import.meta.url);
  return url.pathname.replace(
    /\/tests\/pr_summary_archive_test\.ts$/,
    "",
  );
}

async function listPrSummariesInDocsRoot(): Promise<string[]> {
  const root = repoRoot();
  const offenders: string[] = [];
  for await (const entry of Deno.readDir(`${root}/docs`)) {
    if (
      entry.isFile &&
      /^pr-summary-\d+\.md$/.test(entry.name)
    ) {
      offenders.push(entry.name);
    }
  }
  offenders.sort();
  return offenders;
}

Deno.test("docs/ root contains no pr-summary-*.md files", async () => {
  const offenders = await listPrSummariesInDocsRoot();
  assertEquals(
    offenders.length,
    0,
    `Expected no pr-summary-*.md files in docs/ root, found: ${
      offenders.join(", ")
    }. Move them to docs/archive/ (see Issue #208).`,
  );
});

Deno.test(
  "docs/archive/ contains pr-summary entries (convention is established)",
  async () => {
    const root = repoRoot();
    let count = 0;
    for await (const entry of Deno.readDir(`${root}/docs/archive`)) {
      if (entry.isFile && /^pr-summary-\d+\.md$/.test(entry.name)) {
        count++;
      }
    }
    assert(
      count > 0,
      "Expected docs/archive/ to hold pr-summary-*.md files",
    );
  },
);
