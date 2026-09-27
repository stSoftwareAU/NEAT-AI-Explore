/**
 * Tests for the quiet test reporter on every gate invocation (#650).
 *
 * Deno's default "pretty" reporter prints a pass line per test, burying the
 * one failure on a red run. The required CI job, `quality.sh` and the
 * `deno task test` entry point must all pass `--reporter=dot`, which still
 * prints every failure in full.
 */

import { parse as parseYaml } from "@std/yaml";
import { assert, assertEquals } from "./test_helpers.ts";

const ROOT = new URL("../", import.meta.url);
const QUIET_REPORTER = "--reporter=dot";

interface Workflow {
  jobs?: Record<string, { steps?: { run?: string }[] }>;
}

/** Every `deno test` command line in a block of shell text. */
function denoTestCommands(script: string): string[] {
  return script.split("\n").map((l) => l.trim()).filter((l) =>
    /^deno test(\s|$)/.test(l)
  );
}

function assertQuiet(commands: string[], source: string): void {
  assert(commands.length > 0, `${source} runs no \`deno test\` command`);
  for (const cmd of commands) {
    assert(
      cmd.split(/\s+/).includes(QUIET_REPORTER),
      `${source}: \`${cmd}\` lacks ${QUIET_REPORTER}`,
    );
  }
}

Deno.test("deno-quality.yml - every deno test step uses the dot reporter", async () => {
  const text = await Deno.readTextFile(
    new URL(".github/workflows/deno-quality.yml", ROOT),
  );
  const wf = parseYaml(text) as Workflow;
  const commands = Object.values(wf.jobs ?? {})
    .flatMap((job) => job.steps ?? [])
    .flatMap((step) => denoTestCommands(step.run ?? ""));
  assertQuiet(commands, "deno-quality.yml");
});

Deno.test("quality.sh - deno test uses the dot reporter", async () => {
  const text = await Deno.readTextFile(new URL("quality.sh", ROOT));
  assertQuiet(denoTestCommands(text), "quality.sh");
});

Deno.test("deno.json - test task uses the dot reporter", async () => {
  const config = JSON.parse(
    await Deno.readTextFile(new URL("deno.json", ROOT)),
  ) as { tasks?: Record<string, string> };
  const task = config.tasks?.test;
  assertEquals(typeof task, "string", "deno.json has no `test` task");
  assertQuiet(denoTestCommands(task as string), "deno.json test task");
});

Deno.test("denoTestCommands - ignores non-test lines and comments", () => {
  const found = denoTestCommands(
    "echo hi\n# deno test -A\n  deno test -A --x\ndeno testing",
  );
  assertEquals(JSON.stringify(found), JSON.stringify(["deno test -A --x"]));
  assertEquals(denoTestCommands("").length, 0);
});
