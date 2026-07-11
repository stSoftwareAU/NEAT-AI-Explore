/**
 * Behaviour tests for the committed bash syntax gate `quality/bash_syntax.sh`
 * (#479).
 *
 * Bash has no compile step, so an unparseable script can otherwise land on the
 * default branch unnoticed. The gate runs `bash -n` (a parse-only no-op) over
 * every `*.sh` file under a scan root and fails loud when any script has a
 * syntax error.
 *
 * These tests exercise the real script end-to-end: they build temporary trees
 * of valid and invalid scripts, run the committed gate against them, and
 * assert on its exit status and output — no source-text grepping.
 */

import { assert, assertEquals } from "./test_helpers.ts";

const GATE_SCRIPT = new URL("../quality/bash_syntax.sh", import.meta.url)
  .pathname;
const REPO_ROOT = new URL("../", import.meta.url).pathname;

interface GateResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run the committed gate script against `root` and capture its result. */
async function runGate(root: string): Promise<GateResult> {
  const command = new Deno.Command("bash", {
    args: [GATE_SCRIPT, root],
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await command.output();
  return {
    code,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };
}

Deno.test("bash syntax gate passes for valid scripts (#479)", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      `${dir}/good.sh`,
      "#!/usr/bin/env bash\nset -euo pipefail\necho hello\n",
    );
    await Deno.writeTextFile(
      `${dir}/also_good.sh`,
      "#!/bin/bash\nif true; then echo ok; fi\n",
    );
    const result = await runGate(dir);
    assertEquals(
      result.code,
      0,
      `expected exit 0 for valid scripts, got ${result.code}\n${result.stderr}`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("bash syntax gate fails on a syntax error (#479)", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      `${dir}/good.sh`,
      "#!/usr/bin/env bash\necho fine\n",
    );
    // Unterminated `if` — `bash -n` must reject this.
    await Deno.writeTextFile(
      `${dir}/broken.sh`,
      "#!/usr/bin/env bash\nif true; then\n  echo oops\n",
    );
    const result = await runGate(dir);
    assert(
      result.code !== 0,
      "expected a non-zero exit when a script has a syntax error",
    );
    assert(
      result.stderr.includes("broken.sh"),
      `expected stderr to name the offending script, got:\n${result.stderr}`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("bash syntax gate ignores non-shell files (#479)", async () => {
  const dir = await Deno.makeTempDir();
  try {
    // A .txt file with invalid bash must not be checked.
    await Deno.writeTextFile(`${dir}/notes.txt`, "if true; then\n");
    await Deno.writeTextFile(
      `${dir}/ok.sh`,
      "#!/usr/bin/env bash\necho ok\n",
    );
    const result = await runGate(dir);
    assertEquals(
      result.code,
      0,
      `non-shell files must be ignored, got ${result.code}\n${result.stderr}`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("bash syntax gate tolerates a tree with no scripts (#479)", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${dir}/readme.md`, "# nothing here\n");
    const result = await runGate(dir);
    assertEquals(
      result.code,
      0,
      `an empty scan must succeed, got ${result.code}\n${result.stderr}`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("bash syntax gate errors on a missing scan root (#479)", async () => {
  const result = await runGate("/no/such/path/for/479");
  assert(
    result.code !== 0,
    "expected a non-zero exit when the scan root does not exist",
  );
});

Deno.test("bash syntax gate passes over the repository's own scripts (#479)", async () => {
  const result = await runGate(REPO_ROOT);
  assertEquals(
    result.code,
    0,
    `the repo's committed scripts must parse cleanly, got ${result.code}\n${result.stderr}`,
  );
});
