/**
 * Issue #227 — Regression guard for scripts/generate_pwa_assets.ts.
 *
 * Runs `deno check scripts/generate_pwa_assets.ts` as a subprocess and
 * asserts a zero exit code so any future regression in the Deno port
 * (e.g. an unresolvable jimp/playwright version, a stale npm specifier,
 * or a type mismatch) is caught by CI before it lands.
 *
 * This test deliberately does NOT run the script — that requires Chromium
 * download + network access and is out of scope for unit tests.
 *
 * The previous source-text greps (bare specifiers, deterministic seed
 * `1337`, icon size literals, output filenames, README/CONTRIBUTING prose)
 * were removed under Issue #263. They asserted that the source literally
 * mentioned a string rather than that the script produced the correct
 * outputs — a refactor that kept identical behaviour would still break
 * them. The real contract — "the script runs and emits the expected
 * files" — belongs in an integration test against a real Chromium, not in
 * a unit test that greps the source.
 */

import { assert, assertEquals } from "./test_helpers.ts";

const REPO_ROOT = new URL("..", import.meta.url);

Deno.test("deno check scripts/generate_pwa_assets.ts exits cleanly", async () => {
  const cmd = new Deno.Command("deno", {
    args: ["check", "scripts/generate_pwa_assets.ts"],
    cwd: REPO_ROOT,
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stderr } = await cmd.output();
  const stderrText = new TextDecoder().decode(stderr);

  assertEquals(
    code,
    0,
    `expected 'deno check scripts/generate_pwa_assets.ts' to succeed but got exit ${code}\n${stderrText}`,
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

Deno.test("scripts/generate_pwa_assets.py is removed", async () => {
  const pyPath = new URL(
    "../scripts/generate_pwa_assets.py",
    import.meta.url,
  );
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
    "scripts/generate_pwa_assets.py must be deleted — the Deno port replaces it (Issue #227)",
  );
});
