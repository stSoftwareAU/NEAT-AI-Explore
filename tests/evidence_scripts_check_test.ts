/**
 * Issue #209 — Regression guard for docs/evidence/_take_*.ts.
 *
 * Runs `deno check docs/evidence/` as a subprocess and asserts a zero exit
 * code so any future regression in the screenshot scripts (e.g. an
 * unresolvable astral version or another unsupported screenshot option) is
 * caught by CI.
 */

import { assert, assertEquals } from "./test_helpers.ts";

const REPO_ROOT = new URL("..", import.meta.url);

Deno.test("deno check docs/evidence/ exits cleanly", async () => {
  const cmd = new Deno.Command("deno", {
    args: ["check", "docs/evidence/"],
    cwd: REPO_ROOT,
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stderr } = await cmd.output();
  const stderrText = new TextDecoder().decode(stderr);

  assertEquals(
    code,
    0,
    `expected 'deno check docs/evidence/' to succeed but got exit ${code}\n${stderrText}`,
  );
  assert(
    !stderrText.includes("TS2307"),
    `unexpected TS2307 module resolution error:\n${stderrText}`,
  );
  assert(
    !stderrText.includes("TS2353"),
    `unexpected TS2353 unknown-property error:\n${stderrText}`,
  );
});
