/**
 * Tests for the version downgrade guard (#605).
 *
 * `version.json` must never go backwards relative to the PR base branch. A
 * merge conflict that silently takes Develop's older token used to look like a
 * deliberate bump to the `CURRENT != BASE` skip logic in
 * `.github/workflows/semver-bump.yml`, so a downgrade shipped unnoticed.
 *
 * These are WHAT tests: they call the guard's real functions, and drive the
 * real CLI against throwaway git repositories, asserting on returned values
 * and process exit codes.
 */

import {
  checkVersionNoDowngrade,
  classifyVersionChange,
  comparePackageSemver,
  main,
  parsePackageSemver,
  readVersionFromJson,
} from "../scripts/check_version_no_downgrade.ts";
import { assert, assertEquals } from "./test_helpers.ts";

const REPO_ROOT = new URL("../", import.meta.url).pathname;
const SCRIPT =
  new URL("../scripts/check_version_no_downgrade.ts", import.meta.url)
    .pathname;

function git(cwd: string, ...args: string[]): void {
  const out = new Deno.Command("git", {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  })
    .outputSync();
  if (!out.success) {
    throw new Error(
      `git ${args.join(" ")} failed: ${new TextDecoder().decode(out.stderr)}`,
    );
  }
}

function hasGit(): boolean {
  try {
    return new Deno.Command("git", {
      args: ["--version"],
      stdout: "null",
      stderr: "null",
    })
      .outputSync().success;
  } catch {
    return false;
  }
}

/**
 * Build a throwaway repository whose `Develop` branch carries `baseVersion`
 * and whose checked-out branch carries `headVersion`.
 */
function makeRepo(baseVersion: string, headVersion: string): string {
  const dir = Deno.makeTempDirSync({ prefix: "version-guard-" });
  git(dir, "init", "--quiet", "--initial-branch", "Develop");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "Test");
  Deno.writeTextFileSync(
    `${dir}/version.json`,
    JSON.stringify({ version: baseVersion }, null, 2) + "\n",
  );
  git(dir, "add", "version.json");
  git(dir, "commit", "--quiet", "-m", "base");
  git(dir, "checkout", "--quiet", "-b", "feature");
  Deno.writeTextFileSync(
    `${dir}/version.json`,
    JSON.stringify({ version: headVersion }, null, 2) + "\n",
  );
  git(dir, "add", "version.json");
  // --allow-empty: an unchanged version (the equal case) stages nothing.
  git(dir, "commit", "--quiet", "--allow-empty", "-m", "head");
  return dir;
}

/** Run the guard CLI inside `cwd` and return its exit code plus output. */
function runCli(
  cwd: string,
  ...args: string[]
): { code: number; output: string } {
  const out = new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-read", "--allow-run=git", SCRIPT, ...args],
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).outputSync();
  const decoder = new TextDecoder();
  return {
    code: out.code,
    output: decoder.decode(out.stdout) + decoder.decode(out.stderr),
  };
}

Deno.test("parsePackageSemver accepts plain MAJOR.MINOR.PATCH only", () => {
  assertEquals(parsePackageSemver("0.1.117")?.join("."), "0.1.117");
  assertEquals(parsePackageSemver(" 1.2.3 ")?.join("."), "1.2.3");
  assertEquals(parsePackageSemver("1.2"), null);
  assertEquals(parsePackageSemver("v1.2.3"), null);
  assertEquals(parsePackageSemver("1.2.3-beta.1"), null);
  assertEquals(parsePackageSemver(""), null);
});

Deno.test("comparePackageSemver orders numerically, not lexicographically", () => {
  assert(comparePackageSemver("0.1.117", "0.1.9") > 0);
  assert(comparePackageSemver("0.2.0", "0.10.0") < 0);
  assert(comparePackageSemver("1.0.0", "0.99.99") > 0);
  assertEquals(comparePackageSemver("0.1.117", "0.1.117"), 0);
});

Deno.test("comparePackageSemver throws loudly on an unparseable token", () => {
  let threw = false;
  try {
    comparePackageSemver("1.2.3-rc1", "1.2.3");
  } catch {
    threw = true;
  }
  assert(threw, "expected an invalid semver token to throw");
});

Deno.test("classifyVersionChange labels behind / equal / ahead", () => {
  assertEquals(classifyVersionChange("0.1.116", "0.1.117"), "behind");
  assertEquals(classifyVersionChange("0.1.117", "0.1.117"), "equal");
  assertEquals(classifyVersionChange("0.1.118", "0.1.117"), "ahead");
});

Deno.test("checkVersionNoDowngrade rejects a version behind the base", () => {
  const result = checkVersionNoDowngrade("0.1.116", "0.1.117");
  assertEquals(result.ok, false);
  assertEquals(result.classification, "behind");
  assert(result.message.includes("0.1.116"), "message names the head version");
  assert(result.message.includes("0.1.117"), "message names the base version");
});

Deno.test("checkVersionNoDowngrade accepts equal and ahead versions", () => {
  const equal = checkVersionNoDowngrade("0.1.117", "0.1.117");
  assertEquals(equal.ok, true);
  assertEquals(equal.classification, "equal");

  const ahead = checkVersionNoDowngrade("0.2.0", "0.1.117");
  assertEquals(ahead.ok, true);
  assertEquals(ahead.classification, "ahead");
});

Deno.test("readVersionFromJson extracts the version, or null when absent", () => {
  assertEquals(readVersionFromJson('{"version":"0.1.117"}'), "0.1.117");
  assertEquals(readVersionFromJson("{}"), null);
  assertEquals(readVersionFromJson('{"version":42}'), null);
  assertEquals(readVersionFromJson("not json"), null);
});

Deno.test("main() exits non-zero when version.json is behind the base ref", () => {
  if (!hasGit()) return;
  const dir = makeRepo("0.1.117", "0.1.116");
  try {
    assertEquals(main(["--base-ref", "Develop"], dir), 1);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("main() exits zero for equal and ahead versions", () => {
  if (!hasGit()) return;
  const equalRepo = makeRepo("0.1.117", "0.1.117");
  const aheadRepo = makeRepo("0.1.117", "0.2.0");
  try {
    assertEquals(main(["--base-ref", "Develop"], equalRepo), 0);
    assertEquals(main(["--base-ref", "Develop"], aheadRepo), 0);
  } finally {
    Deno.removeSync(equalRepo, { recursive: true });
    Deno.removeSync(aheadRepo, { recursive: true });
  }
});

Deno.test("main() fails loudly when the base ref cannot be read", () => {
  if (!hasGit()) return;
  const dir = makeRepo("0.1.117", "0.1.117");
  try {
    assertEquals(main(["--base-ref", "origin/NoSuchBranch"], dir), 2);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("main() rejects an unknown flag rather than ignoring it", () => {
  assertEquals(main(["--bogus"], REPO_ROOT), 2);
});

Deno.test("guard CLI exits 1 on a downgrade and 0 otherwise", () => {
  if (!hasGit()) return;
  const behind = makeRepo("0.1.117", "0.1.116");
  const ahead = makeRepo("0.1.117", "0.1.118");
  try {
    const failed = runCli(behind, "--base-ref", "Develop");
    assertEquals(failed.code, 1);
    assert(
      failed.output.includes("behind"),
      `expected a downgrade message, got: ${failed.output}`,
    );
    assertEquals(runCli(ahead, "--base-ref", "Develop").code, 0);
  } finally {
    Deno.removeSync(behind, { recursive: true });
    Deno.removeSync(ahead, { recursive: true });
  }
});

Deno.test({
  name: "repository version.json is not behind origin/Develop",
  // Skipped when origin/Develop is not fetched (shallow CI checkout, offline
  // clone); the semver-bump workflow fetches it and enforces the same rule.
  ignore: !hasGit() ||
    !new Deno.Command("git", {
      args: ["rev-parse", "--verify", "--quiet", "origin/Develop"],
      cwd: REPO_ROOT,
      stdout: "null",
      stderr: "null",
    }).outputSync().success,
  fn: () => {
    assertEquals(main(["--base-ref", "origin/Develop"], REPO_ROOT), 0);
  },
});
