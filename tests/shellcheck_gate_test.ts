/**
 * Behaviour tests for the committed shellcheck gate `quality/shellcheck.sh`
 * (#480).
 *
 * Bash has no compile step, so common mistakes — unquoted expansions, undefined
 * variables — slip past `bash -n`. The gate runs `shellcheck` over every `*.sh`
 * file under a scan root and fails loud when any script trips a finding at or
 * above the configured severity.
 *
 * These tests exercise the real script end-to-end: they build temporary trees
 * of clean and problematic scripts, run the committed gate against them, and
 * assert on its exit status and output — no source-text grepping. When
 * `shellcheck` is not installed the linting cases are skipped, since the gate
 * cannot run without it.
 */

import { assert, assertEquals } from "./test_helpers.ts";

const GATE_SCRIPT = new URL("../quality/shellcheck.sh", import.meta.url)
  .pathname;
const REPO_ROOT = new URL("../", import.meta.url).pathname;

interface GateResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Whether shellcheck is available on the PATH of this test runner. */
async function hasShellcheck(): Promise<boolean> {
  try {
    const { code } = await new Deno.Command("shellcheck", {
      args: ["--version"],
      stdout: "null",
      stderr: "null",
    }).output();
    return code === 0;
  } catch {
    return false;
  }
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

const shellcheckAvailable = await hasShellcheck();

Deno.test({
  name: "shellcheck gate passes for clean scripts (#480)",
  ignore: !shellcheckAvailable,
  fn: async () => {
    const dir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(
        `${dir}/good.sh`,
        '#!/usr/bin/env bash\nset -euo pipefail\nname="world"\necho "hello ${name}"\n',
      );
      const result = await runGate(dir);
      assertEquals(
        result.code,
        0,
        `expected exit 0 for a clean script, got ${result.code}\n${result.stderr}`,
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "shellcheck gate fails on a lint finding (#480)",
  ignore: !shellcheckAvailable,
  fn: async () => {
    const dir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(
        `${dir}/clean.sh`,
        '#!/usr/bin/env bash\necho "fine"\n',
      );
      // SC2154: `undefined` is referenced but never assigned — a warning-level
      // finding the gate must reject.
      await Deno.writeTextFile(
        `${dir}/bad.sh`,
        "#!/usr/bin/env bash\necho $undefined\n",
      );
      const result = await runGate(dir);
      assert(
        result.code !== 0,
        "expected a non-zero exit when a script has a shellcheck finding",
      );
      assert(
        result.stdout.includes("bad.sh") || result.stderr.includes("bad.sh"),
        `expected output to name the offending script, got:\n${result.stdout}\n${result.stderr}`,
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "shellcheck gate ignores non-shell files (#480)",
  ignore: !shellcheckAvailable,
  fn: async () => {
    const dir = await Deno.makeTempDir();
    try {
      // A .txt file with a shell-lint smell must not be checked.
      await Deno.writeTextFile(`${dir}/notes.txt`, "echo $undefined\n");
      await Deno.writeTextFile(
        `${dir}/ok.sh`,
        '#!/usr/bin/env bash\necho "ok"\n',
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
  },
});

Deno.test({
  name: "shellcheck gate tolerates a tree with no scripts (#480)",
  ignore: !shellcheckAvailable,
  fn: async () => {
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
  },
});

Deno.test("shellcheck gate errors on a missing scan root (#480)", async () => {
  const result = await runGate("/no/such/path/for/480");
  assert(
    result.code !== 0,
    "expected a non-zero exit when the scan root does not exist",
  );
});

Deno.test({
  name: "shellcheck gate passes over the repository's own scripts (#480)",
  ignore: !shellcheckAvailable,
  fn: async () => {
    const result = await runGate(REPO_ROOT);
    assertEquals(
      result.code,
      0,
      `the repo's committed scripts must lint cleanly, got ${result.code}\n${result.stderr}`,
    );
  },
});
