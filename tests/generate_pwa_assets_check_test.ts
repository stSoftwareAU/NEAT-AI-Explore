/**
 * Issue #227 — Regression guard for scripts/generate_pwa_assets.ts.
 *
 * Mirrors `tests/capture_transition_evidence_check_test.ts`: runs
 * `deno check scripts/generate_pwa_assets.ts` as a subprocess and asserts a
 * zero exit code so any future regression in the Deno port (e.g. an
 * unresolvable jimp/playwright version, a stale npm specifier, or a type
 * mismatch) is caught by CI before it lands.
 *
 * This test deliberately does NOT run the script — that requires Chromium
 * download + network access and is out of scope for unit tests.
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

Deno.test("scripts/generate_pwa_assets.ts uses bare specifiers for npm deps", async () => {
  const src = await Deno.readTextFile(
    new URL("../scripts/generate_pwa_assets.ts", import.meta.url),
  );
  // Inline `npm:` specifiers are forbidden by the project's no-import-prefix
  // lint rule; jimp + playwright must go through the deno.json `imports`
  // map so the quarantine gate can age-check the pinned versions.
  assert(
    !/from\s+["']npm:jimp/.test(src),
    "generate_pwa_assets.ts must import 'jimp' via the deno.json imports map, not via an inline 'npm:' specifier",
  );
  assert(
    !/from\s+["']npm:playwright/.test(src),
    "generate_pwa_assets.ts must import 'playwright' via the deno.json imports map, not via an inline 'npm:' specifier",
  );
  assert(
    /from\s+["']jimp["']/.test(src),
    "generate_pwa_assets.ts must import the bare 'jimp' specifier",
  );
  assert(
    /from\s+["']playwright["']/.test(src),
    "generate_pwa_assets.ts must import the bare 'playwright' specifier",
  );
});

Deno.test("scripts/generate_pwa_assets.ts pins the deterministic seed (1337)", async () => {
  const src = await Deno.readTextFile(
    new URL("../scripts/generate_pwa_assets.ts", import.meta.url),
  );
  // The Python original used random.Random(1337). The Deno port keeps the same
  // seed so generated icons remain stable between runs on the same machine.
  assert(
    /\b1337\b/.test(src),
    "generate_pwa_assets.ts must keep the deterministic PRNG seed (1337) from the Python original",
  );
});

Deno.test("scripts/generate_pwa_assets.ts targets the same icon sizes as the Python original", async () => {
  const src = await Deno.readTextFile(
    new URL("../scripts/generate_pwa_assets.ts", import.meta.url),
  );
  // The PWA manifest, README, and favicon all depend on this exact size set.
  const required = [16, 32, 48, 72, 96, 128, 144, 152, 192, 384, 512];
  for (const size of required) {
    assert(
      new RegExp(`\\b${size}\\b`).test(src),
      `generate_pwa_assets.ts must reference icon size ${size}`,
    );
  }
});

Deno.test("scripts/generate_pwa_assets.ts writes favicon + screenshot outputs", async () => {
  const src = await Deno.readTextFile(
    new URL("../scripts/generate_pwa_assets.ts", import.meta.url),
  );
  // These output paths are referenced from the manifest / README so the port
  // must preserve every filename the Python original produced.
  const required = [
    "favicon.ico",
    "icon-source.png",
    "desktop-screenshot.png",
    "mobile-screenshot.png",
    "iphone-screenshot.png",
    "ipad-screenshot.png",
    "desktop-inbound-modal.png",
    "iphone-inbound-modal.png",
    "ipad-inbound-modal.png",
    "graph-desktop.png",
    "graph-desktop-focus.png",
    "graph-desktop-tilt.png",
  ];
  for (const name of required) {
    assert(
      src.includes(name),
      `generate_pwa_assets.ts must reference output filename '${name}'`,
    );
  }
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

Deno.test("README and CONTRIBUTING reference the Deno entry point (not Python)", async () => {
  const readme = await Deno.readTextFile(
    new URL("../README.md", import.meta.url),
  );
  const contributing = await Deno.readTextFile(
    new URL("../CONTRIBUTING.md", import.meta.url),
  );

  assert(
    !readme.includes("generate_pwa_assets.py"),
    "README.md must not reference the deleted Python script",
  );
  assert(
    !readme.includes("pip install pillow"),
    "README.md must not instruct users to 'pip install pillow' anymore",
  );
  assert(
    readme.includes("generate_pwa_assets.ts"),
    "README.md must reference the new Deno entry point",
  );

  assert(
    !contributing.includes("generate_pwa_assets.py"),
    "CONTRIBUTING.md must not reference the deleted Python script",
  );
  assert(
    !contributing.includes("Python 3 + Playwright"),
    "CONTRIBUTING.md must drop the Python 3 + Playwright prerequisite",
  );
});
