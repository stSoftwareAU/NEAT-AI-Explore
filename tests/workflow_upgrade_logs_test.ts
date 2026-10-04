/**
 * Behaviour tests for the ANSI-coloured upgrade logs committed by the
 * `upgrade-dependencies.yml` workflow (#660).
 *
 * The "Upgrade dependencies" step runs `deno outdated --latest` and
 * `deno outdated --update --latest`, teeing both to files in the checkout
 * root (`upgrade-dry-run.txt`, `upgrade.log`). Because the runner forces
 * colour even though the pipe to `tee` is not a TTY, those files end up full
 * of ANSI escapes, and because they live inside the checkout,
 * peter-evans/create-pull-request picks them up and commits them alongside
 * the real `deno.json`/`deno.lock` changes — noise in every dependency-bump
 * PR. The fix moves both logs to `$RUNNER_TEMP` (outside the checkout, so
 * they are never staged) and forces `NO_COLOR=1` / unsets `FORCE_COLOR` so
 * the "Build summary" step embeds plain text in the PR body.
 *
 * Rather than grepping the YAML for the literal fix, these tests execute the
 * real `run:` scripts from the workflow under a `deno` stub that mirrors the
 * observed Deno 2.9.6 colour contract: output is coloured whenever
 * `FORCE_COLOR` is set to any non-empty value (even "0", even alongside
 * `NO_COLOR=1`); only `NO_COLOR` non-empty with `FORCE_COLOR` empty/unset
 * yields plain text. A fix that does not really relocate the logs and strip
 * colour fails here regardless of how the YAML is spelt.
 */

import { assert, assertEquals } from "./test_helpers.ts";
import {
  loadWorkflow,
  type Workflow,
  type WorkflowStep,
} from "./workflow_helpers.ts";

// workflow_helpers.ts does not export findStep; declare the small local
// helper here instead of widening the shared module's surface.
function findStep(
  wf: Workflow,
  job: string,
  stepName: string,
): WorkflowStep {
  const step = (wf.jobs?.[job]?.steps ?? []).find((s) => s.name === stepName);
  assert(step !== undefined, `job '${job}' must have a step '${stepName}'`);
  return step!;
}

/** The `deno` stub script shared by every run below. */
const DENO_STUB = `#!/usr/bin/env bash
set -euo pipefail
if [ "\${1:-}" = "outdated" ]; then
  if [ -n "\${NO_COLOR:-}" ] && [ -z "\${FORCE_COLOR:-}" ]; then
    echo 'Download https://registry.npmjs.org/example'
    echo '| jsr:@std/yaml | 1.0.0 | 1.0.1 |'
  else
    printf '\\x1b[0m\\x1b[32mDownload\\x1b[0m https://registry.npmjs.org/example\\n'
    printf '| jsr:@std/yaml | \\x1b[31m1.0.0\\x1b[0m | \\x1b[32m1.0.1\\x1b[0m |\\n'
  fi
  exit 0
fi
echo "unexpected deno invocation: $*" >&2
exit 1
`;

interface StepDirs {
  checkoutDir: string;
  runnerTempDir: string;
  githubOutputFile: string;
  stubDir: string;
}

interface StepRunResult {
  code: number;
  stderr: string;
  checkoutEntries: string[];
  checkoutFiles: Record<string, string>;
  runnerTempFiles: Record<string, string>;
  githubOutput: string;
}

async function makeDirs(): Promise<StepDirs> {
  const checkoutDir = await Deno.makeTempDir({ prefix: "upgrade-checkout-" });
  const runnerTempDir = await Deno.makeTempDir({
    prefix: "upgrade-runner-temp-",
  });
  const outputDir = await Deno.makeTempDir({ prefix: "upgrade-output-" });
  const stubDir = await Deno.makeTempDir({ prefix: "upgrade-stub-" });
  const githubOutputFile = `${outputDir}/github_output.txt`;
  await Deno.writeTextFile(githubOutputFile, "");

  const stubPath = `${stubDir}/deno`;
  await Deno.writeTextFile(stubPath, DENO_STUB);
  await Deno.chmod(stubPath, 0o755);

  return { checkoutDir, runnerTempDir, githubOutputFile, stubDir };
}

async function removeDirs(dirs: StepDirs): Promise<void> {
  await Deno.remove(dirs.checkoutDir, { recursive: true }).catch(() => {});
  await Deno.remove(dirs.runnerTempDir, { recursive: true }).catch(() => {});
  await Deno.remove(dirs.stubDir, { recursive: true }).catch(() => {});
}

async function readDirAsMap(dir: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for await (const entry of Deno.readDir(dir)) {
    if (!entry.isFile) continue;
    files[entry.name] = await Deno.readTextFile(`${dir}/${entry.name}`);
  }
  return files;
}

/**
 * Run one `run:` script the way GitHub Actions runs a step: `bash -e -c`,
 * cwd set to the checkout, with only the environment GitHub guarantees plus
 * the step's own declared `env:` entries (string values only — expression
 * placeholders like `${{ secrets.X }}` are not evaluable offline and are
 * skipped).
 */
async function runStep(
  run: string,
  stepEnv: Record<string, unknown> | undefined,
  dirs: StepDirs,
): Promise<StepRunResult> {
  const env: Record<string, string> = {
    PATH: `${dirs.stubDir}:${Deno.env.get("PATH") ?? ""}`,
    HOME: Deno.env.get("HOME") ?? "/tmp",
    RUNNER_TEMP: dirs.runnerTempDir,
    GITHUB_OUTPUT: dirs.githubOutputFile,
    // The runner forces colour even though stdout is piped into `tee`;
    // model that rather than relying on a non-TTY heuristic.
    FORCE_COLOR: "1",
  };
  for (const [key, value] of Object.entries(stepEnv ?? {})) {
    if (typeof value === "string" && !value.includes("${{")) {
      env[key] = value;
    }
  }

  const command = new Deno.Command("bash", {
    args: ["-e", "-c", run],
    cwd: dirs.checkoutDir,
    env,
    clearEnv: true,
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stderr } = await command.output();

  const checkoutFiles = await readDirAsMap(dirs.checkoutDir);
  const runnerTempFiles = await readDirAsMap(dirs.runnerTempDir);
  const githubOutput = await Deno.readTextFile(dirs.githubOutputFile);

  return {
    code,
    stderr: new TextDecoder().decode(stderr),
    checkoutEntries: Object.keys(checkoutFiles),
    checkoutFiles,
    runnerTempFiles,
    githubOutput,
  };
}

Deno.test(
  "upgrade-dependencies 'Upgrade dependencies' writes no files into the checkout (#660)",
  async () => {
    const wf = await loadWorkflow("upgrade-dependencies.yml");
    const step = findStep(wf, "upgrade", "Upgrade dependencies");
    const dirs = await makeDirs();
    try {
      const result = await runStep(step.run ?? "", step.env, dirs);
      assertEquals(
        result.code,
        0,
        `step exited ${result.code}, stderr: ${result.stderr}`,
      );
      assertEquals(
        result.checkoutEntries.length,
        0,
        `checkout dir should be empty but has: ${
          result.checkoutEntries.join(", ")
        }`,
      );
    } finally {
      await removeDirs(dirs);
    }
  },
);

Deno.test(
  "upgrade-dependencies 'Upgrade dependencies' captures both logs under RUNNER_TEMP without ANSI escapes (#660)",
  async () => {
    const wf = await loadWorkflow("upgrade-dependencies.yml");
    const step = findStep(wf, "upgrade", "Upgrade dependencies");
    const dirs = await makeDirs();
    try {
      const result = await runStep(step.run ?? "", step.env, dirs);
      assertEquals(
        result.code,
        0,
        `step exited ${result.code}, stderr: ${result.stderr}`,
      );

      const dryRun = result.runnerTempFiles["upgrade-dry-run.txt"];
      assert(
        dryRun !== undefined,
        `expected RUNNER_TEMP/upgrade-dry-run.txt, found: ${
          Object.keys(result.runnerTempFiles).join(", ")
        }`,
      );
      assert(
        dryRun.includes("jsr:@std/yaml"),
        "upgrade-dry-run.txt should contain the outdated package table",
      );
      assert(
        !dryRun.includes("\x1b"),
        "upgrade-dry-run.txt should not contain ANSI escapes",
      );

      const fullLog = result.runnerTempFiles["upgrade.log"];
      assert(
        fullLog !== undefined,
        `expected RUNNER_TEMP/upgrade.log, found: ${
          Object.keys(result.runnerTempFiles).join(", ")
        }`,
      );
      assert(
        fullLog.includes("jsr:@std/yaml"),
        "upgrade.log should contain the outdated package table",
      );
      assert(
        !fullLog.includes("\x1b"),
        "upgrade.log should not contain ANSI escapes",
      );
    } finally {
      await removeDirs(dirs);
    }
  },
);

Deno.test(
  "upgrade-dependencies 'Build summary' embeds the colourless dry-run from RUNNER_TEMP (#660)",
  async () => {
    const wf = await loadWorkflow("upgrade-dependencies.yml");
    const upgradeStep = findStep(wf, "upgrade", "Upgrade dependencies");
    const summaryStep = findStep(wf, "upgrade", "Build summary");
    const dirs = await makeDirs();
    try {
      const upgradeResult = await runStep(
        upgradeStep.run ?? "",
        upgradeStep.env,
        dirs,
      );
      assertEquals(
        upgradeResult.code,
        0,
        `Upgrade dependencies exited ${upgradeResult.code}, stderr: ${upgradeResult.stderr}`,
      );

      const summaryResult = await runStep(
        summaryStep.run ?? "",
        summaryStep.env,
        dirs,
      );
      assertEquals(
        summaryResult.code,
        0,
        `Build summary exited ${summaryResult.code}, stderr: ${summaryResult.stderr}`,
      );
      assert(
        summaryResult.githubOutput.includes("jsr:@std/yaml"),
        `GITHUB_OUTPUT should embed the dry-run table, got: ${summaryResult.githubOutput}`,
      );
      assert(
        !summaryResult.githubOutput.includes("\x1b"),
        "GITHUB_OUTPUT should not contain ANSI escapes",
      );
    } finally {
      await removeDirs(dirs);
    }
  },
);

Deno.test(
  "deno stub contract - colour unless NO_COLOR set and FORCE_COLOR unset (negative/positive checks) (#660)",
  async () => {
    const dirs = await makeDirs();
    try {
      // Negative: the current (unfixed) one-liner, no step env — the stub
      // must still colour under the inherited FORCE_COLOR=1, proving this
      // harness can actually fail a bad step.
      const uncoloured = await runStep(
        "set -euo pipefail\n" +
          "deno outdated --latest 2>&1 | tee upgrade-dry-run.txt || true\n",
        undefined,
        dirs,
      );
      assertEquals(
        uncoloured.checkoutEntries.join(","),
        "upgrade-dry-run.txt",
        `expected upgrade-dry-run.txt in checkout, found: ${
          uncoloured.checkoutEntries.join(", ")
        }`,
      );
      const negativeContent = uncoloured.checkoutFiles["upgrade-dry-run.txt"] ??
        "";
      assert(
        negativeContent.includes("\x1b"),
        "unfixed script should still produce ANSI escapes (stub sanity check)",
      );
    } finally {
      await removeDirs(dirs);
    }

    const dirs2 = await makeDirs();
    try {
      // Positive: `unset FORCE_COLOR` + `NO_COLOR=1`, teeing into
      // RUNNER_TEMP — the fixed shape — must be colourless and leave the
      // checkout untouched.
      const coloured = await runStep(
        "set -euo pipefail\n" +
          "unset FORCE_COLOR\n" +
          'deno outdated --latest 2>&1 | tee "$RUNNER_TEMP/x.txt" || true\n',
        { NO_COLOR: "1" },
        dirs2,
      );
      assertEquals(
        coloured.checkoutEntries.length,
        0,
        `checkout should stay empty, found: ${
          coloured.checkoutEntries.join(", ")
        }`,
      );
      const positiveContent = coloured.runnerTempFiles["x.txt"] ?? "";
      assert(
        !positiveContent.includes("\x1b"),
        "fixed script with NO_COLOR=1 and unset FORCE_COLOR should be colourless",
      );
    } finally {
      await removeDirs(dirs2);
    }
  },
);

Deno.test("tracked upgrade logs are removed from the repo root (#660)", async () => {
  for (const name of ["upgrade.log", "upgrade-dry-run.txt"]) {
    let notFound = false;
    try {
      await Deno.stat(new URL(`../${name}`, import.meta.url));
    } catch (error) {
      notFound = error instanceof Deno.errors.NotFound;
      if (!notFound) throw error;
    }
    assert(
      notFound,
      `${name} should have been deleted from the repo root (#660)`,
    );
  }
});
