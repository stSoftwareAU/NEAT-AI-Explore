/**
 * Issue #224 — Regression guard for scripts/verify_starfield_layout.ts.
 *
 * Mirrors `tests/evidence_scripts_check_test.ts`: runs
 * `deno check scripts/verify_starfield_layout.ts` as a subprocess and
 * asserts a zero exit code so any future regression in the Deno port
 * (e.g. an unresolvable playwright version, a stale npm specifier, or a
 * type mismatch against the playwright API) is caught by CI before it
 * lands in production.
 *
 * This test deliberately does NOT launch a browser — that requires a
 * working Chromium download and is out of scope for unit tests.
 */

import { assert, assertEquals } from "./test_helpers.ts";

const REPO_ROOT = new URL("..", import.meta.url);

Deno.test("deno check scripts/verify_starfield_layout.ts exits cleanly", async () => {
  const cmd = new Deno.Command("deno", {
    args: ["check", "scripts/verify_starfield_layout.ts"],
    cwd: REPO_ROOT,
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stderr } = await cmd.output();
  const stderrText = new TextDecoder().decode(stderr);

  assertEquals(
    code,
    0,
    `expected 'deno check scripts/verify_starfield_layout.ts' to succeed but got exit ${code}\n${stderrText}`,
  );
  assert(
    !stderrText.includes("TS2307"),
    `unexpected TS2307 module resolution error:\n${stderrText}`,
  );
  assert(
    !stderrText.includes("TS2584"),
    `unexpected TS2584 missing-DOM-lib error:\n${stderrText}`,
  );
});

Deno.test("scripts/verify_starfield_layout.ts uses bare 'playwright' specifier", async () => {
  const src = await Deno.readTextFile(
    new URL("../scripts/verify_starfield_layout.ts", import.meta.url),
  );
  // Inline `npm:` specifiers are forbidden by the project's no-import-prefix
  // lint rule; the playwright import must go through the deno.json `imports`
  // map so the quarantine gate can age-check the pinned version.
  assert(
    !/from\s+["']npm:playwright/.test(src),
    "verify_starfield_layout.ts must import 'playwright' via the deno.json imports map, not via an inline 'npm:' specifier",
  );
  assert(
    /from\s+["']playwright["']/.test(src),
    "verify_starfield_layout.ts must import the bare 'playwright' specifier",
  );
});

Deno.test("deno.json pins playwright to an exact npm version", async () => {
  const text = await Deno.readTextFile(
    new URL("../deno.json", import.meta.url),
  );
  const config = JSON.parse(text) as { imports?: Record<string, string> };
  const spec = config.imports?.["playwright"];
  assert(
    typeof spec === "string" && spec.length > 0,
    "deno.json imports must define 'playwright'",
  );
  assert(
    spec!.startsWith("npm:playwright@"),
    `expected playwright to be an npm: specifier, got '${spec}'`,
  );
  // Forbid wildcards / ranges — the quarantine gate needs a concrete pin.
  assert(
    /^npm:playwright@\d+\.\d+\.\d+$/.test(spec!),
    `playwright must be pinned to an exact X.Y.Z version, got '${spec}'`,
  );
});
