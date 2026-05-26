/**
 * Issue #225 — Regression guard for scripts/verify_theme_layout.ts.
 *
 * Runs `deno check scripts/verify_theme_layout.ts` as a subprocess and
 * asserts a zero exit code so any future regression in the Deno port
 * (e.g. an unresolvable playwright version, a stale npm specifier, or a
 * type mismatch against the playwright API) is caught by CI before it
 * lands.
 *
 * This test deliberately does NOT launch a browser — that requires a
 * working Chromium download and is out of scope for unit tests.
 *
 * The previous source-text grep for the `from "playwright"` specifier was
 * removed under Issue #263 — the bare-specifier rule is enforced by the
 * project's no-import-prefix lint rule, and `deno check` already proves
 * the import resolves.
 */

import { assert, assertEquals } from "./test_helpers.ts";

const REPO_ROOT = new URL("..", import.meta.url);

Deno.test("deno check scripts/verify_theme_layout.ts exits cleanly", async () => {
  const cmd = new Deno.Command("deno", {
    args: ["check", "scripts/verify_theme_layout.ts"],
    cwd: REPO_ROOT,
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stderr } = await cmd.output();
  const stderrText = new TextDecoder().decode(stderr);

  assertEquals(
    code,
    0,
    `expected 'deno check scripts/verify_theme_layout.ts' to succeed but got exit ${code}\n${stderrText}`,
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

Deno.test("scripts/verify_theme_layout.py is removed", async () => {
  const pyPath = new URL("../scripts/verify_theme_layout.py", import.meta.url);
  let exists = false;
  try {
    await Deno.stat(pyPath);
    exists = true;
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) {
      throw err;
    }
  }
  assert(
    !exists,
    "scripts/verify_theme_layout.py must be deleted — the Deno port replaces it (Issue #225)",
  );
});
