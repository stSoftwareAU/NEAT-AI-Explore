function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  // .../tests/split_synapse_candidate_ui_test.ts -> repo root
  const root = here.replace(
    /\/tests\/split_synapse_candidate_ui_test\.ts$/,
    "",
  );
  return [root, ...parts].join("/");
}

Deno.test("UI supports split-synapse insert-neuron discovery candidates", async () => {
  const appPath = repoPath("docs", "app.js");
  const js = await Deno.readTextFile(appPath);

  assert(
    js.includes("split_synapse_insert_neuron"),
    `Expected ${appPath} to mention the split_synapse_insert_neuron candidate type`,
  );
  assert(
    js.includes("Synapse count Δ") || js.includes("Synapse count delta"),
    `Expected ${appPath} to include a before/after synapse count delta summary`,
  );
  assert(
    js.includes("Neuron count Δ") || js.includes("Neuron count delta"),
    `Expected ${appPath} to include a before/after neuron count delta summary`,
  );
  assert(
    js.includes("Removed synapse") || js.includes("Removed edge"),
    `Expected ${appPath} to describe which synapse is removed in the diff view`,
  );
});

Deno.test("UI includes an Issues tab (28-Dec-2025)", async () => {
  const htmlPath = repoPath("docs", "index.html");
  const html = await Deno.readTextFile(htmlPath);

  assert(
    html.includes("Issues"),
    `Expected ${htmlPath} to include an Issues tab label`,
  );
  assert(
    html.includes("neuronTabIssues"),
    `Expected ${htmlPath} to include a #neuronTabIssues button`,
  );
  assert(
    html.includes("neuronTabPanelIssues"),
    `Expected ${htmlPath} to include a #neuronTabPanelIssues container`,
  );
});
