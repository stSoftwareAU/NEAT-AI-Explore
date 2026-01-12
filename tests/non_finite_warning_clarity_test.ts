/**
 * Issue #62: The "non-finite" warning was confusing because:
 * 1. The term "non-finite" is technical jargon - users may think it relates
 *    to string UUIDs being "finite" rather than NaN/Infinity in numeric data.
 * 2. When obsIndices contains string identifiers (e.g. "first-one"), showing
 *    "first obs_index=second-one" is confusing.
 *
 * Fix: Rename to "NaN/Infinity" and improve observation identifier display.
 */

function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  const root = here.replace(
    /\/tests\/non_finite_warning_clarity_test\.ts$/,
    "",
  );
  return [root, ...parts].join("/");
}

Deno.test(
  "Issues tab uses 'NaN/Infinity' instead of confusing 'non-finite' terminology",
  async () => {
    const appPath = repoPath("docs", "app.js");
    const js = await Deno.readTextFile(appPath);

    // The section title should use clearer terminology.
    assert(
      js.includes("NaN/Infinity"),
      `Expected ${appPath} to use 'NaN/Infinity' label instead of just 'non-finite'`,
    );

    // The row title should explain what the diagnostic checks for.
    assert(
      js.includes("NaN/Infinity (exploding gradients)"),
      `Expected ${appPath} to show 'NaN/Infinity (exploding gradients)' as a clearer row title`,
    );
  },
);

Deno.test(
  "Observation identifier display uses 'obs' not 'obs_index' when value is non-numeric",
  async () => {
    const appPath = repoPath("docs", "app.js");
    const js = await Deno.readTextFile(appPath);

    // The display should use "first obs" when the identifier might be a string.
    // The function should check if the obsIndex is a number vs string.
    assert(
      js.includes("formatObsRef"),
      `Expected ${appPath} to have a formatObsRef helper for observation identifier display`,
    );
  },
);

Deno.test(
  "Flagged neurons list uses clearer 'NaN/Infinity' section title",
  async () => {
    const appPath = repoPath("docs", "app.js");
    const js = await Deno.readTextFile(appPath);

    // The flagged neurons list section should use consistent clearer terminology.
    assert(
      js.includes('"NaN/Infinity (top 10)"'),
      `Expected ${appPath} to use 'NaN/Infinity (top 10)' for the flagged neurons list`,
    );
  },
);
