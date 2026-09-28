/**
 * Behaviour tests for the licence-less gitleaks fallback (#609).
 *
 * `gitleaks/gitleaks-action` needs an organisation licence on org-owned
 * repositories. Dependabot-authored pull requests receive no Actions secrets,
 * so `GITLEAKS_LICENSE` arrives empty and the action exits with `ErrLicense`
 * before scanning anything — the job goes green over an unscanned diff, which
 * is worse than no gate at all because it reads as covered.
 *
 * `quality/gitleaks_scan.sh` is the licence-less scanner CI runs instead. These
 * tests execute the committed script end-to-end against temporary git
 * repositories with a stubbed scanner binary, and execute the workflow's own
 * licence-less fallback `run:` block under `bash`, so the assertions are about real
 * behaviour rather than the source text.
 */

import { assert, assertEquals } from "./test_helpers.ts";
import { loadWorkflow, type WorkflowStep } from "./workflow_helpers.ts";

const SCAN_SCRIPT =
  new URL("../quality/gitleaks_scan.sh", import.meta.url).pathname;

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: Record<string, string> } = {},
): Promise<RunResult> {
  const command = new Deno.Command(cmd, {
    args,
    cwd: opts.cwd,
    env: opts.env,
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

/**
 * A stand-in for the gitleaks CLI that records its argv to `argvPath` and
 * exits with `exitCode`. It lets the tests observe which scan the script chose
 * without downloading anything.
 */
async function writeStubScanner(
  path: string,
  argvPath: string,
  exitCode = 0,
): Promise<void> {
  await Deno.writeTextFile(
    path,
    `#!/usr/bin/env bash\nprintf '%s\\n' "$@" >> ${
      JSON.stringify(argvPath)
    }\nexit ${exitCode}\n`,
  );
  await Deno.chmod(path, 0o755);
}

/** Initialise a git repository with one commit and return its SHA. */
async function initRepo(dir: string): Promise<string> {
  const env = {
    PATH: Deno.env.get("PATH") ?? "",
    HOME: dir,
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.com",
  };
  await run("git", ["init", "-q", "-b", "main", dir], { env });
  await Deno.writeTextFile(`${dir}/file.txt`, "hello\n");
  await run("git", ["add", "."], { cwd: dir, env });
  await run("git", ["commit", "-q", "-m", "first"], { cwd: dir, env });
  const head = await run("git", ["rev-parse", "HEAD"], { cwd: dir, env });
  return head.stdout.trim();
}

/** Run the committed scan script over `dir` with a stubbed scanner. */
async function runScan(
  dir: string,
  extraEnv: Record<string, string> = {},
): Promise<RunResult> {
  return await run("bash", [SCAN_SCRIPT, dir], {
    cwd: dir,
    env: {
      PATH: Deno.env.get("PATH") ?? "",
      HOME: dir,
      ...extraEnv,
    },
  });
}

Deno.test("gitleaks fallback scans the pull-request commit range (#609)", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const head = await initRepo(dir);
    const argv = `${dir}/argv.txt`;
    await writeStubScanner(`${dir}/stub-gitleaks`, argv);

    const result = await runScan(dir, {
      GITLEAKS_BIN: `${dir}/stub-gitleaks`,
      BASE_SHA: head,
      HEAD_SHA: head,
    });

    assertEquals(result.code, 0, `expected a clean scan\n${result.stderr}`);
    const args = (await Deno.readTextFile(argv)).split("\n");
    assertEquals(args[0], "git", "a reachable range must use `gitleaks git`");
    assert(
      args.includes(`--log-opts=${head}..${head}`),
      `expected the commit range to be passed, got:\n${args.join(" ")}`,
    );
    assert(
      args.includes("--exit-code") && args.includes("1"),
      "a leak must fail the gate, so --exit-code 1 is required",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("gitleaks fallback scans the whole tree when no range is given (#609)", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await initRepo(dir);
    const argv = `${dir}/argv.txt`;
    await writeStubScanner(`${dir}/stub-gitleaks`, argv);

    const result = await runScan(dir, { GITLEAKS_BIN: `${dir}/stub-gitleaks` });

    assertEquals(result.code, 0, `expected a clean scan\n${result.stderr}`);
    const args = (await Deno.readTextFile(argv)).split("\n");
    assertEquals(
      args[0],
      "dir",
      "with no commit range the whole working tree must be scanned, never nothing",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("gitleaks fallback scans the whole tree for an unreachable range (#609)", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await initRepo(dir);
    const argv = `${dir}/argv.txt`;
    await writeStubScanner(`${dir}/stub-gitleaks`, argv);

    // A well-formed SHA that is not an object in this checkout — the shallow
    // clone case that would otherwise scan an empty range and report success.
    const absent = "0".repeat(39) + "1";
    const result = await runScan(dir, {
      GITLEAKS_BIN: `${dir}/stub-gitleaks`,
      BASE_SHA: absent,
      HEAD_SHA: absent,
    });

    assertEquals(result.code, 0, `expected a clean scan\n${result.stderr}`);
    const args = (await Deno.readTextFile(argv)).split("\n");
    assertEquals(
      args[0],
      "dir",
      "an unreachable range must fall back to a whole-tree scan",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("gitleaks fallback propagates a detected leak as a failure (#609)", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await initRepo(dir);
    const argv = `${dir}/argv.txt`;
    // Exit 1 is what gitleaks returns under `--exit-code 1` when it finds a
    // secret; the gate must fail rather than swallow it.
    await writeStubScanner(`${dir}/stub-gitleaks`, argv, 1);

    const result = await runScan(dir, { GITLEAKS_BIN: `${dir}/stub-gitleaks` });

    assert(result.code !== 0, "a detected leak must fail the gate");
    assertEquals(
      await Deno.stat(argv).then(() => true).catch(() => false),
      true,
      "the failure must come from a scan that actually ran",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("gitleaks fallback fails loud when the pinned binary is unusable (#609)", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await initRepo(dir);
    await Deno.writeTextFile(`${dir}/not-executable`, "not a binary\n");

    const result = await runScan(dir, {
      GITLEAKS_BIN: `${dir}/not-executable`,
    });

    assert(result.code !== 0, "an unusable scanner must not report success");
    assert(
      result.stderr.includes("not-executable"),
      `expected stderr to name the unusable binary, got:\n${result.stderr}`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

/**
 * Build a `gitleaks` tarball served from a local directory, mimicking the
 * upstream release layout (`<base>/v<version>/<asset>`), and return the asset
 * name plus its real SHA-256.
 */
async function publishFakeRelease(
  dir: string,
  version: string,
  markerPath: string,
  exitCode = 0,
): Promise<{ asset: string; sha256: string; baseUrl: string }> {
  const releaseDir = `${dir}/releases/v${version}`;
  await Deno.mkdir(releaseDir, { recursive: true });
  const stageDir = `${dir}/stage`;
  await Deno.mkdir(stageDir, { recursive: true });
  await writeStubScanner(`${stageDir}/gitleaks`, markerPath, exitCode);

  const asset = `gitleaks_${version}_test.tar.gz`;
  const tar = await run("tar", [
    "-czf",
    `${releaseDir}/${asset}`,
    "-C",
    stageDir,
    "gitleaks",
  ]);
  assertEquals(
    tar.code,
    0,
    `could not build the fixture tarball\n${tar.stderr}`,
  );

  const digest = await crypto.subtle.digest(
    "SHA-256",
    await Deno.readFile(`${releaseDir}/${asset}`),
  );
  const sha256 = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return { asset, sha256, baseUrl: `file://${dir}/releases` };
}

Deno.test("gitleaks fallback runs a download whose checksum matches (#609)", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await initRepo(dir);
    const argv = `${dir}/argv.txt`;
    const { asset, sha256, baseUrl } = await publishFakeRelease(
      dir,
      "9.9.9",
      argv,
    );

    const result = await runScan(dir, {
      GITLEAKS_VERSION: "9.9.9",
      GITLEAKS_ASSET: asset,
      GITLEAKS_SHA256: sha256,
      GITLEAKS_BASE_URL: baseUrl,
    });

    assertEquals(
      result.code,
      0,
      `a verified download must run\n${result.stdout}\n${result.stderr}`,
    );
    const args = (await Deno.readTextFile(argv)).split("\n");
    assertEquals(args[0], "dir", "the downloaded scanner must be invoked");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("gitleaks fallback refuses a download whose checksum differs (#609)", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await initRepo(dir);
    const argv = `${dir}/argv.txt`;
    const { asset, baseUrl } = await publishFakeRelease(dir, "9.9.9", argv);

    const result = await runScan(dir, {
      GITLEAKS_VERSION: "9.9.9",
      GITLEAKS_ASSET: asset,
      GITLEAKS_SHA256: "f".repeat(64),
      GITLEAKS_BASE_URL: baseUrl,
    });

    assert(result.code !== 0, "a tampered download must not be trusted");
    assert(
      result.stderr.toLowerCase().includes("checksum"),
      `expected a checksum failure on stderr, got:\n${result.stderr}`,
    );
    assertEquals(
      await Deno.stat(argv).then(() => true).catch(() => false),
      false,
      "an unverified binary must never be executed",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("gitleaks fallback fails loud when the download is missing (#609)", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await initRepo(dir);
    const result = await runScan(dir, {
      GITLEAKS_VERSION: "9.9.9",
      GITLEAKS_ASSET: "gitleaks_9.9.9_test.tar.gz",
      GITLEAKS_SHA256: "f".repeat(64),
      GITLEAKS_BASE_URL: `file://${dir}/no-such-release-dir`,
    });

    assert(result.code !== 0, "an undownloadable scanner must fail the gate");
    assert(
      result.stderr.includes("download"),
      `expected the download failure to be named, got:\n${result.stderr}`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// --- Workflow wiring -------------------------------------------------------

const GITLEAKS_WORKFLOW = "gitleaks.yml";

async function gitleaksSteps(): Promise<WorkflowStep[]> {
  const wf = await loadWorkflow(GITLEAKS_WORKFLOW);
  const job = wf.jobs?.gitleaks;
  assert(job !== undefined, "gitleaks.yml must keep its `gitleaks` job");
  return job!.steps ?? [];
}

Deno.test("gitleaks workflow gates on a job-level licence (#651)", async () => {
  const wf = await loadWorkflow(GITLEAKS_WORKFLOW);
  const job = wf.jobs?.gitleaks as { env?: Record<string, unknown> };
  // The `secrets` context is not available in a step `if:`; `env` is.
  assertEquals(
    job.env?.GITLEAKS_LICENSE,
    "${{ secrets.GITLEAKS_LICENSE }}",
    "the licence must be exposed at job level so step `if:`s can read it",
  );

  const steps = await gitleaksSteps();
  const licensed = steps.find((s) =>
    typeof s.uses === "string" && s.uses.startsWith("gitleaks/gitleaks-action@")
  );
  assert(licensed !== undefined, "the licensed action must still be wired up");
  assertEquals(
    licensed!.if,
    "env.GITLEAKS_LICENSE != ''",
    "the licensed action must only run when a licence is actually present",
  );

  const fallback = await fallbackStep();
  assertEquals(
    fallback.if,
    "env.GITLEAKS_LICENSE == ''",
    "the fallback must run exactly when the licensed action does not",
  );
  // runFallbackStep injects these itself, so only this pins the step's env.
  assertEquals(
    fallback.env?.BASE_SHA,
    "${{ github.event.pull_request.base.sha }}",
    "the fallback's `run:` reads BASE_SHA under `set -u`",
  );
  assertEquals(
    fallback.env?.HEAD_SHA,
    "${{ github.event.pull_request.head.sha }}",
    "the fallback's `run:` reads HEAD_SHA under `set -u`",
  );
});

/**
 * The fleet audit's contract for "a licence-less scanner exists" (#651): a
 * `run:` line that invokes the `gitleaks` binary itself, bare or by path.
 * Mirrors `CLI_INVOCATION` in VibeCoder's `gitleaks_drift_scanner.ts`.
 */
const CLI_INVOCATION = /(?:^|[\s;&|(`])(?:\.{0,2}\/[\w./-]*)?gitleaks(?=\s|$)/m;

Deno.test("gitleaks fallback step invokes the CLI where the audit can see it (#651)", async () => {
  const fallback = await fallbackStep();
  assert(
    CLI_INVOCATION.test(fallback.run ?? ""),
    "the fallback must call `gitleaks` directly, not only via a wrapper script",
  );
  // The pattern must not be satisfied by the wrapper's own name.
  assertEquals(CLI_INVOCATION.test("./quality/gitleaks_scan.sh ."), false);
});

/** The licence-less step: the one `run:` that installs the pinned CLI. */
async function fallbackStep(): Promise<WorkflowStep> {
  const steps = await gitleaksSteps();
  const fallback = steps.find((s) =>
    typeof s.run === "string" && s.run.includes("quality/gitleaks_scan.sh")
  );
  assert(
    fallback !== undefined,
    "gitleaks.yml must install the CLI via the committed gate script",
  );
  return fallback!;
}

/**
 * Execute the workflow's fallback `run:` block, as the runner would, inside a
 * temporary checkout. The CLI is "downloaded" from a local fake release so the
 * real pinned-install path runs; the stub records the argv it was given.
 */
async function runFallbackStep(
  opts: { baseSha: string; headSha: string; stubExit?: number },
): Promise<{ result: RunResult; argv: string[] | null; head: string }> {
  const fallback = await fallbackStep();
  const dir = await Deno.makeTempDir();
  try {
    const repo = `${dir}/repo`;
    const head = await initRepo(repo);
    await Deno.mkdir(`${repo}/quality`);
    await Deno.copyFile(SCAN_SCRIPT, `${repo}/quality/gitleaks_scan.sh`);
    await Deno.chmod(`${repo}/quality/gitleaks_scan.sh`, 0o755);

    const argvPath = `${dir}/argv.txt`;
    const release = await publishFakeRelease(
      dir,
      "9.9.9",
      argvPath,
      opts.stubExit ?? 0,
    );

    const runnerTemp = `${dir}/runner-temp`;
    await Deno.mkdir(runnerTemp);
    await Deno.writeTextFile(`${dir}/step.sh`, fallback.run ?? "");
    const result = await run("bash", [`${dir}/step.sh`], {
      cwd: repo,
      env: {
        PATH: Deno.env.get("PATH") ?? "",
        HOME: dir,
        RUNNER_TEMP: runnerTemp,
        BASE_SHA: opts.baseSha.replace("HEAD", head),
        HEAD_SHA: opts.headSha.replace("HEAD", head),
        GITLEAKS_VERSION: "9.9.9",
        GITLEAKS_ASSET: release.asset,
        GITLEAKS_SHA256: release.sha256,
        GITLEAKS_BASE_URL: release.baseUrl,
      },
    });
    const argv = await Deno.readTextFile(argvPath)
      .then((t) => t.split("\n").filter((l) => l !== ""))
      .catch(() => null);
    return { result, argv, head };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("gitleaks fallback step invokes the CLI on the PR range (#651)", async () => {
  const { result, argv, head } = await runFallbackStep({
    baseSha: "HEAD",
    headSha: "HEAD",
  });
  assertEquals(
    result.code,
    0,
    `the fallback step must succeed\n${result.stdout}\n${result.stderr}`,
  );
  assertEquals(
    JSON.stringify(argv),
    JSON.stringify([
      "git",
      "--redact",
      "--no-banner",
      "--exit-code",
      "1",
      `--log-opts=${head}..${head}`,
      ".",
    ]),
    "the step must run the verified CLI directly over the PR commit range",
  );
});

Deno.test("gitleaks fallback step fails on a detected leak (#651)", async () => {
  const { result, argv } = await runFallbackStep({
    baseSha: "HEAD",
    headSha: "HEAD",
    stubExit: 1,
  });
  assert(argv !== null, "the CLI must have been invoked");
  assert(result.code !== 0, "a leak reported by the CLI must fail the step");
});

Deno.test("gitleaks fallback step refuses an unreachable range (#651)", async () => {
  // `gitleaks git --log-opts` exits 0 on a range git cannot resolve, so the
  // step must fail loud rather than report green over nothing.
  const { result, argv } = await runFallbackStep({
    baseSha: "0".repeat(40),
    headSha: "HEAD",
  });
  assert(result.code !== 0, "an unreachable range must fail the step");
  assertEquals(argv, null, "the CLI must not run over an unresolvable range");
});

Deno.test("gitleaks_scan.sh --install places the verified CLI in a directory (#651)", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const argv = `${dir}/argv.txt`;
    const release = await publishFakeRelease(dir, "9.9.9", argv);
    const env = {
      PATH: Deno.env.get("PATH") ?? "",
      HOME: dir,
      GITLEAKS_VERSION: "9.9.9",
      GITLEAKS_ASSET: release.asset,
      GITLEAKS_BASE_URL: release.baseUrl,
    };

    const ok = await run("bash", [SCAN_SCRIPT, "--install", `${dir}/bin`], {
      env: { ...env, GITLEAKS_SHA256: release.sha256 },
    });
    assertEquals(ok.code, 0, `install must succeed\n${ok.stderr}`);
    const stat = await Deno.stat(`${dir}/bin/gitleaks`);
    assert(stat.isFile, "the CLI must be installed as <dir>/gitleaks");
    assertEquals(
      await Deno.stat(argv).then(() => true).catch(() => false),
      false,
      "install mode must not run a scan",
    );

    const bad = await run("bash", [SCAN_SCRIPT, "--install", `${dir}/bad`], {
      env: { ...env, GITLEAKS_SHA256: "f".repeat(64) },
    });
    assert(bad.code !== 0, "a tampered download must not be installed");
    assertEquals(
      await Deno.stat(`${dir}/bad/gitleaks`).then(() => true).catch(() =>
        false
      ),
      false,
      "an unverified binary must never land in the install directory",
    );

    const noDir = await run("bash", [SCAN_SCRIPT, "--install"], { env });
    assert(noDir.code !== 0, "--install without a directory must fail loud");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("the committed scanner referenced by gitleaks.yml exists (#609)", async () => {
  const stat = await Deno.stat(SCAN_SCRIPT);
  assert(stat.isFile, "quality/gitleaks_scan.sh must be a regular file");
});
