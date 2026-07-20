import { assert, assertEquals } from "./test_helpers.ts";

/**
 * Verifies that DOM-free shared modules are covered by `deno lint`.
 *
 * If the deno.json lint exclusions are accidentally widened back to
 * "docs/**", these tests fail: passing an excluded file explicitly makes
 * `deno lint` exit non-zero ("No target files found"), so `result.success`
 * is a stable proxy for "the module was actually a lint target, not
 * silently skipped". The assertions below read Deno's machine-readable
 * `--json` report (a stable schema) rather than scraping the human-readable
 * summary prose, which a Deno version bump could reword at any time.
 */

interface LintReport {
  version: number;
  diagnostics: unknown[];
  errors: unknown[];
  checked_files?: string[];
}

function repoRoot(): string {
  const url = new URL(import.meta.url);
  return url.pathname.replace(/\/tests\/lint_coverage_test\.ts$/, "");
}

/** Run `deno lint --json` on a single file and return the result. */
async function lintFile(
  relativePath: string,
): Promise<{ success: boolean; stdout: string; stderr: string }> {
  const fullPath = `${repoRoot()}/${relativePath}`;
  const cmd = new Deno.Command("deno", {
    args: ["lint", "--json", fullPath],
    stdout: "piped",
    stderr: "piped",
  });
  const out = await cmd.output();
  return {
    success: out.success,
    stdout: new TextDecoder().decode(out.stdout),
    stderr: new TextDecoder().decode(out.stderr),
  };
}

/**
 * Assert a shared module was linted cleanly against Deno's stable `--json`
 * schema. `result.success` proves the module was a real lint target (an
 * excluded file exits non-zero); the parsed report proves the tool produced
 * a structured, diagnostic-free result without relying on any summary wording.
 */
function assertLintedClean(mod: string, result: {
  success: boolean;
  stdout: string;
  stderr: string;
}): void {
  assert(
    result.success,
    `deno lint failed for ${mod}:\n${result.stderr}`,
  );
  const report = JSON.parse(result.stdout) as LintReport;
  assertEquals(
    report.diagnostics?.length ?? 0,
    0,
    `Expected no lint diagnostics for ${mod}, got: ${
      JSON.stringify(report.diagnostics)
    }`,
  );
  assertEquals(
    report.errors?.length ?? 0,
    0,
    `Expected no lint errors for ${mod}, got: ${JSON.stringify(report.errors)}`,
  );
}

const SHARED_MODULES = [
  "docs/shared/config.js",
  "docs/shared/creature_overview.js",
  "docs/shared/graph_analysis.js",
  "docs/shared/snapshot_loader.js",
  "docs/shared/colour_maps.js",
  "docs/shared/transitions.js",
  "docs/shared/touch_gestures.js",
  "docs/shared/sparkline.js",
  "docs/shared/responsive.js",
  "docs/shared/selection_attribution.js",
];

for (const mod of SHARED_MODULES) {
  const name = mod.split("/").pop()!;
  Deno.test(`deno lint covers shared module: ${name}`, async () => {
    const result = await lintFile(mod);
    assertLintedClean(mod, result);
  });
}

Deno.test("deno lint covers impact_attribution.js", async () => {
  const mod = "docs/impact_attribution.js";
  const result = await lintFile(mod);
  assertLintedClean(mod, result);
});

Deno.test("deno lint covers impact_diagnostics.js", async () => {
  const mod = "docs/impact_diagnostics.js";
  const result = await lintFile(mod);
  assertLintedClean(mod, result);
});

Deno.test("deno lint configuration excludes DOM-dependent files", async () => {
  const root = repoRoot();
  const configText = await Deno.readTextFile(`${root}/deno.json`);
  const config = JSON.parse(configText);
  const excludes: string[] = config?.lint?.exclude ?? [];

  // Shared DOM-free modules must NOT appear in the exclusion list
  for (const mod of SHARED_MODULES) {
    assertEquals(
      excludes.includes(mod),
      false,
      `${mod} should not be in lint.exclude`,
    );
  }

  // DOM-dependent files SHOULD be excluded
  const expectedExclusions = [
    "docs/app.js",
    "docs/sw.js",
    "docs/shared/theme.js",
    "docs/starfield/starfield.js",
  ];
  for (const exc of expectedExclusions) {
    assertEquals(
      excludes.includes(exc),
      true,
      `${exc} should be in lint.exclude (DOM-dependent)`,
    );
  }
});
