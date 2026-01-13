/**
 * Issue #68: Flagging a constant doesn't make sense
 *
 * When a neuron is a constant (near-zero std dev), it should not appear in the
 * "Flagged neurons" lists like "Dead zone %" or "Clamp %". A constant neuron
 * that always outputs the same value will naturally have 100% of its values at
 * one point, which isn't a problem - it's by design.
 *
 * This test ensures that constant neurons are excluded from the flagged lists.
 */

function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  const root = here.replace(
    /\/tests\/constant_neuron_flagging_test\.ts$/,
    "",
  );
  return [root, ...parts].join("/");
}

Deno.test(
  "Flagged neurons lists filter out constant inputs from clampedUuids",
  async () => {
    const appPath = repoPath("docs", "app.js");
    const js = await Deno.readTextFile(appPath);

    // The clampedUuids array should filter out constant inputs.
    // We look for the filter pattern applied to the clampedUuids variable.
    // The filter should reference a constant input lookup.
    const clampedSection = js.substring(
      js.indexOf("const clampedUuids"),
      js.indexOf("const clampedUuids") + 400,
    );

    assert(
      clampedSection.includes("constantInputUuids") ||
        clampedSection.includes("CONSTANT_INPUT_UUIDS") ||
        clampedSection.includes("isConstantInput"),
      `Expected clampedUuids to filter out constant inputs. Found: ${
        clampedSection.slice(0, 200)
      }...`,
    );
  },
);

Deno.test(
  "Flagged neurons lists filter out constant inputs from deadReluUuids",
  async () => {
    const appPath = repoPath("docs", "app.js");
    const js = await Deno.readTextFile(appPath);

    // The deadReluUuids array should filter out constant inputs.
    const deadReluSection = js.substring(
      js.indexOf("const deadReluUuids"),
      js.indexOf("const deadReluUuids") + 400,
    );

    assert(
      deadReluSection.includes("constantInputUuids") ||
        deadReluSection.includes("CONSTANT_INPUT_UUIDS") ||
        deadReluSection.includes("isConstantInput"),
      `Expected deadReluUuids to filter out constant inputs. Found: ${
        deadReluSection.slice(0, 200)
      }...`,
    );
  },
);

Deno.test(
  "Constant input UUIDs are collected into a Set for efficient lookup",
  async () => {
    const appPath = repoPath("docs", "app.js");
    const js = await Deno.readTextFile(appPath);

    // There should be a Set of constant input UUIDs built from DIAG_INPUTS.constantInputs
    // for use in filtering the flagged neurons lists.
    assert(
      js.includes("constantInputUuids") ||
        js.includes("CONSTANT_INPUT_UUIDS"),
      `Expected ${appPath} to have a Set of constant input UUIDs for filtering`,
    );

    // The Set should be built from the constantInputs array.
    assert(
      js.includes("new Set") &&
        (js.includes("constantInputs") || js.includes("DIAG_INPUTS")),
      `Expected the constant input UUIDs Set to be built from constantInputs`,
    );
  },
);

Deno.test(
  "Comment explains why constants are excluded from flagged lists",
  async () => {
    const appPath = repoPath("docs", "app.js");
    const js = await Deno.readTextFile(appPath);

    // There should be a comment near the flagged lists section explaining why
    // constants are excluded. Look for Issue #68 reference or explanatory text.
    const flaggedSection = js.substring(
      js.indexOf("Flagged neurons"),
      js.indexOf("Flagged neurons") + 1000,
    );

    const hasExplanatoryComment = flaggedSection.includes("#68") ||
      flaggedSection.includes("constant") &&
        (flaggedSection.includes("exclude") ||
          flaggedSection.includes("filter") ||
          flaggedSection.includes("skip") ||
          flaggedSection.includes("by design"));
    assert(
      hasExplanatoryComment,
      `Expected a comment explaining why constants are excluded from flagged lists`,
    );
  },
);
