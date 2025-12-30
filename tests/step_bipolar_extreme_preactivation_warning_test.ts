function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  // .../tests/step_bipolar_extreme_preactivation_warning_test.ts -> repo root
  const root = here.replace(
    /\/tests\/step_bipolar_extreme_preactivation_warning_test\.ts$/,
    "",
  );
  return [root, ...parts].join("/");
}

Deno.test(
  "neuron panel warns when STEP/BIPOLAR has extreme pre-activation so MSE/MAE can be dominated by saturation/outliers",
  async () => {
    const appPath = repoPath("docs", "app.js");
    const js = await Deno.readTextFile(appPath);

    // Text must be short, practical, and point the user at the Issues tab.
    assert(
      js.includes("MSE/MAE warning"),
      `Expected ${appPath} to include an 'MSE/MAE warning' row label`,
    );
    assert(
      js.includes("value-domain"),
      `Expected ${appPath} warning text to mention 'value-domain' errors`,
    );
    assert(
      js.includes("Issues tab"),
      `Expected ${appPath} warning text to reference the 'Issues tab'`,
    );

    // Guardrails: only for STEP/BIPOLAR + extreme pre-activation.
    assert(
      js.includes("EXTREME_PREACTIVATION_ABS_MAX_FOR_STEP_BIPOLAR"),
      `Expected ${appPath} to define an extreme pre-activation threshold constant`,
    );
    assert(
      js.includes("isStepOrBipolarSquash"),
      `Expected ${appPath} to encapsulate STEP/BIPOLAR detection (isStepOrBipolarSquash)`,
    );
    assert(
      js.includes("Pre-activation |x| max"),
      `Expected ${appPath} to key off the 'Pre-activation |x| max' statistic`,
    );
  },
);
