/**
 * Issue #228 — Regression guard for `deno.lock` after the Python Playwright
 * port-out (#222 series).
 *
 * Once all four Python scripts were ported to Deno (#224–#227) the lockfile
 * was refreshed so the only remaining `npm:playwright*` specifier matches the
 * single pinned import in `deno.json`. This test pins that contract so a stray
 * orphan entry (e.g. `npm:playwright@*` or `npm:@playwright/test@*`) cannot
 * regress in.
 *
 * It also sweeps the repo for any reintroduced Python Playwright artefacts:
 * `*.py` files under `scripts/`, `requirements*.txt`, and `pyproject.toml`.
 *
 * Note (#331): a prose grep for `pip install ... playwright` instructions in
 * README/CONTRIBUTING was removed. A forbidden free-text pattern in docs is a
 * lint/CI policy concern, not a unit-test assertion — it broke on rewording
 * and gave little signal. The durable artefact checks (no `*.py`, no Python
 * project metadata) remain and cover the actual port-out regression.
 */

import { assert, assertEquals } from "./test_helpers.ts";

const REPO_ROOT = new URL("..", import.meta.url);

interface DenoLock {
  specifiers?: Record<string, string>;
}

async function loadLock(): Promise<DenoLock> {
  const text = await Deno.readTextFile(new URL("deno.lock", REPO_ROOT));
  return JSON.parse(text) as DenoLock;
}

Deno.test("deno.lock has no orphan playwright specifiers", async () => {
  const lock = await loadLock();
  const specifiers = lock.specifiers ?? {};
  const playwrightKeys = Object.keys(specifiers).filter((k) =>
    k.startsWith("npm:playwright") || k.startsWith("npm:@playwright")
  );

  // After the port-out only the single pinned entry from deno.json's imports
  // map should survive a `deno cache --reload`.
  assertEquals(
    playwrightKeys.length,
    1,
    `expected exactly one npm:playwright* specifier in deno.lock, found:\n${
      playwrightKeys.join("\n")
    }`,
  );

  const [only] = playwrightKeys;
  assert(
    /^npm:playwright@\d+\.\d+\.\d+$/.test(only),
    `the lone playwright specifier must be a concrete X.Y.Z pin, got '${only}'`,
  );
  assert(
    !only.includes("@*"),
    `wildcard playwright specifier leaked back into deno.lock: '${only}'`,
  );
});

Deno.test("deno.lock playwright specifier matches the deno.json pin", async () => {
  const [lock, denoJsonText] = await Promise.all([
    loadLock(),
    Deno.readTextFile(new URL("deno.json", REPO_ROOT)),
  ]);
  const denoJson = JSON.parse(denoJsonText) as {
    imports?: Record<string, string>;
  };
  const pin = denoJson.imports?.["playwright"] ?? "";
  assert(pin.startsWith("npm:playwright@"), "deno.json must pin playwright");

  const lockKey = pin; // both use the `npm:playwright@X.Y.Z` form
  const specifiers = lock.specifiers ?? {};
  assert(
    Object.prototype.hasOwnProperty.call(specifiers, lockKey),
    `deno.lock missing the pinned specifier '${lockKey}' (specifiers: ${
      Object.keys(specifiers).join(", ")
    })`,
  );
  assertEquals(
    specifiers[lockKey],
    pin.slice("npm:playwright@".length),
    `lockfile resolution for '${lockKey}' should equal the deno.json pin`,
  );
});

Deno.test("no Python files remain under scripts/", async () => {
  const offenders: string[] = [];
  for await (const entry of Deno.readDir(new URL("scripts/", REPO_ROOT))) {
    if (entry.isFile && entry.name.endsWith(".py")) offenders.push(entry.name);
  }
  assertEquals(
    offenders.length,
    0,
    `expected no *.py files under scripts/, found: ${offenders.join(", ")}`,
  );
});

Deno.test("no Python project metadata files remain at repo root", async () => {
  const offenders: string[] = [];
  for await (const entry of Deno.readDir(REPO_ROOT)) {
    if (!entry.isFile) continue;
    if (
      entry.name === "pyproject.toml" ||
      /^requirements.*\.txt$/.test(entry.name)
    ) {
      offenders.push(entry.name);
    }
  }
  assertEquals(
    offenders.length,
    0,
    `expected no Python project metadata at repo root, found: ${
      offenders.join(", ")
    }`,
  );
});
