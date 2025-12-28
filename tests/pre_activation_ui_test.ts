function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  // .../tests/pre_activation_ui_test.ts -> repo root
  const root = here.replace(/\/tests\/pre_activation_ui_test\.ts$/, "");
  return [root, ...parts].join("/");
}

Deno.test("neuron panel shows pre-activation (net input) stats", async () => {
  const appPath = repoPath("docs", "app.js");
  const js = await Deno.readTextFile(appPath);

  assert(
    js.includes("Pre-activation mean"),
    `Expected ${appPath} to include a 'Pre-activation mean' row`,
  );
  assert(
    js.includes("Pre-activation range"),
    `Expected ${appPath} to include a 'Pre-activation range' row`,
  );
  assert(
    js.includes("summariseSeriesStats"),
    `Expected ${appPath} to compute pre-activation stats via summariseSeriesStats`,
  );
  assert(
    js.includes("net input") || js.includes("Pre-activation (net input)"),
    `Expected ${appPath} to use the 'net input' terminology`,
  );
});
