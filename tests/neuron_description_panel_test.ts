function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  // .../tests/neuron_description_panel_test.ts -> repo root
  const root = here.replace(/\/tests\/neuron_description_panel_test\.ts$/, "");
  return [root, ...parts].join("/");
}

Deno.test("neuron details panel shows label and description (mobile-friendly)", async () => {
  const appPath = repoPath("docs", "app.js");
  const js = await Deno.readTextFile(appPath);

  // We render an explicit description block (don't rely on `title` hover).
  assert(
    js.includes("currentNeuronDesc"),
    `Expected ${appPath} to render a #currentNeuronDesc element`,
  );

  const cssPath = repoPath("docs", "styles.css");
  const css = await Deno.readTextFile(cssPath);
  assert(
    css.includes(".neuronDescription"),
    `Expected ${cssPath} to style .neuronDescription`,
  );
});
