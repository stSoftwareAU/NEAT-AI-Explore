import { assert, assertEquals } from "./test_helpers.ts";

/**
 * Verifies that DOM-free shared modules are covered by `deno lint`.
 *
 * If the deno.json lint exclusions are accidentally widened back to
 * "docs/**", these tests will fail because `deno lint` will skip the
 * shared modules entirely (exit-code 0 but "Checked 0 files").
 */

function repoRoot(): string {
  const url = new URL(import.meta.url);
  return url.pathname.replace(/\/tests\/lint_coverage_test\.ts$/, "");
}

/** Run `deno lint` on a single file and return the result. */
async function lintFile(
  relativePath: string,
): Promise<{ success: boolean; stdout: string; stderr: string }> {
  const fullPath = `${repoRoot()}/${relativePath}`;
  const cmd = new Deno.Command("deno", {
    args: ["lint", fullPath],
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

const SHARED_MODULES = [
  "docs/shared/config.js",
  "docs/shared/creature_overview.js",
  "docs/shared/graph_analysis.js",
  "docs/shared/snapshot_loader.js",
  "docs/shared/colour_maps.js",
  "docs/shared/transitions.js",
  "docs/shared/touch_gestures.js",
];

for (const mod of SHARED_MODULES) {
  const name = mod.split("/").pop()!;
  Deno.test(`deno lint covers shared module: ${name}`, async () => {
    const result = await lintFile(mod);
    assert(
      result.success,
      `deno lint failed for ${mod}:\n${result.stderr}`,
    );
    // Verify the file was actually checked (not silently skipped)
    assert(
      result.stderr.includes("Checked 1 file"),
      `Expected deno lint to check ${mod} but output was:\n${result.stderr}`,
    );
  });
}

Deno.test("deno lint covers impact_attribution.js", async () => {
  const result = await lintFile("docs/impact_attribution.js");
  assert(result.success, `deno lint failed:\n${result.stderr}`);
  assert(
    result.stderr.includes("Checked 1 file"),
    `Expected deno lint to check impact_attribution.js but output was:\n${result.stderr}`,
  );
});

Deno.test("deno lint covers impact_diagnostics.js", async () => {
  const result = await lintFile("docs/impact_diagnostics.js");
  assert(result.success, `deno lint failed:\n${result.stderr}`);
  assert(
    result.stderr.includes("Checked 1 file"),
    `Expected deno lint to check impact_diagnostics.js but output was:\n${result.stderr}`,
  );
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
  ];
  for (const exc of expectedExclusions) {
    assertEquals(
      excludes.includes(exc),
      true,
      `${exc} should be in lint.exclude (DOM-dependent)`,
    );
  }
});
