/**
 * Issue #210 — Regression guard for the `deno check` line in quality.sh.
 *
 * Reads quality.sh as text and asserts that the `deno check` invocation
 * type-checks the whole tree (covers docs/) rather than the old
 * `helpers/ scripts/ tests/` allowlist. This catches accidental reversions
 * that would re-hide type errors under docs/ from local and CI quality
 * gates.
 */

import { assert } from "./test_helpers.ts";

const QUALITY_SH = new URL("../quality.sh", import.meta.url);

async function loadQualityScript(): Promise<string> {
  return await Deno.readTextFile(QUALITY_SH);
}

function findDenoCheckLine(text: string): string | undefined {
  const lines = text.split("\n");
  return lines.find((l) => /^\s*deno check\b/.test(l));
}

Deno.test("quality.sh runs deno check covering docs/ (Issue #210)", async () => {
  const text = await loadQualityScript();
  const line = findDenoCheckLine(text);
  assert(line, "quality.sh must contain a 'deno check' invocation");
  assert(
    line!.includes("docs/"),
    `quality.sh 'deno check' line must cover docs/, got: ${line}`,
  );
});

Deno.test("quality.sh's deno check is not restricted to helpers/ scripts/ tests/ (Issue #210)", async () => {
  const text = await loadQualityScript();
  const line = findDenoCheckLine(text);
  assert(line, "quality.sh must contain a 'deno check' invocation");
  assert(
    !/^\s*deno check\s+helpers\/\s+scripts\/\s+tests\/\s*$/.test(line!),
    `quality.sh 'deno check' must not be restricted to helpers/ scripts/ tests/, got: ${line}`,
  );
});
