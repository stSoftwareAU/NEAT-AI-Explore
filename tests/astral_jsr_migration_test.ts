/**
 * Issue #414 — Regression guard for the `astral` migration off the abandoned
 * `deno.land/x` distribution channel onto the maintained JSR package
 * `@astral/astral`.
 *
 * The evidence/screenshot scripts (`docs/evidence/_take_*.ts`) previously
 * imported `https://deno.land/x/astral@0.3.5/mod.ts` — a frozen, orphaned
 * channel that also dragged in stale transitive `deno.land/x` modules
 * (`zipjs`, `progress`, `dir`). This test pins the migrated contract so the
 * dead channel cannot regress back in:
 *
 * - `deno.json` maps `@astral/astral` to a `jsr:@astral/astral` pin.
 * - No `deno.land/x/astral` (or its stale transitives) survive in `deno.lock`.
 * - The three evidence scripts import the bare `@astral/astral` specifier.
 */

import { assert, assertEquals } from "./test_helpers.ts";

const REPO_ROOT = new URL("..", import.meta.url);

const EVIDENCE_SCRIPTS = [
  "docs/evidence/_take_screenshots.ts",
  "docs/evidence/_take_loading_screenshots.ts",
  "docs/evidence/_take_loading_fix.ts",
];

interface DenoLock {
  specifiers?: Record<string, string>;
  remote?: Record<string, string>;
}

async function loadJson<T>(name: string): Promise<T> {
  const text = await Deno.readTextFile(new URL(name, REPO_ROOT));
  return JSON.parse(text) as T;
}

Deno.test("deno.json pins @astral/astral to the JSR package", async () => {
  const denoJson = await loadJson<{ imports?: Record<string, string> }>(
    "deno.json",
  );
  const pin = denoJson.imports?.["@astral/astral"] ?? "";
  assert(
    /^jsr:@astral\/astral@/.test(pin),
    `expected deno.json to pin @astral/astral to jsr:@astral/astral@…, got '${pin}'`,
  );
});

Deno.test("deno.lock has no orphaned deno.land/x/astral entries", async () => {
  const lock = await loadJson<DenoLock>("deno.lock");
  const remote = lock.remote ?? {};
  const astralRemote = Object.keys(remote).filter((k) =>
    k.includes("deno.land/x/astral")
  );
  assertEquals(
    astralRemote.length,
    0,
    `expected no deno.land/x/astral remote entries in deno.lock, found:\n${
      astralRemote.join("\n")
    }`,
  );
});

Deno.test("deno.lock drops astral's stale deno.land/x transitives", async () => {
  const lock = await loadJson<DenoLock>("deno.lock");
  const remote = lock.remote ?? {};
  // These modules only reached the lockfile via the frozen deno.land/x astral
  // channel; migrating the single astral import must prune them all.
  const staleTransitives = ["zipjs", "progress", "dir"];
  const offenders = Object.keys(remote).filter((k) =>
    staleTransitives.some((m) => k.includes(`deno.land/x/${m}`))
  );
  assertEquals(
    offenders.length,
    0,
    `expected no stale deno.land/x transitives in deno.lock, found:\n${
      offenders.join("\n")
    }`,
  );
});

Deno.test("deno.lock resolves the JSR astral specifier", async () => {
  const lock = await loadJson<DenoLock>("deno.lock");
  const specifiers = lock.specifiers ?? {};
  const astralKeys = Object.keys(specifiers).filter((k) =>
    k.startsWith("jsr:@astral/astral@")
  );
  assertEquals(
    astralKeys.length,
    1,
    `expected exactly one jsr:@astral/astral specifier in deno.lock, found:\n${
      astralKeys.join("\n")
    }`,
  );
});

Deno.test("evidence scripts import the JSR astral specifier, not deno.land/x", async () => {
  for (const script of EVIDENCE_SCRIPTS) {
    const source = await Deno.readTextFile(new URL(script, REPO_ROOT));
    assert(
      source.includes('from "@astral/astral"'),
      `${script} should import from '@astral/astral'`,
    );
    assert(
      !source.includes("deno.land/x/astral"),
      `${script} must not import the abandoned deno.land/x/astral channel`,
    );
  }
});
