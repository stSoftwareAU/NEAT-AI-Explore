function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  // .../tests/starfield_back_trail_test.ts -> repo root
  const root = here.replace(/\/tests\/starfield_back_trail_test\.ts$/, "");
  return [root, ...parts].join("/");
}

Deno.test("starfield supports back navigation + focus trail (path home)", async () => {
  const jsPath = repoPath("docs", "starfield", "starfield.js");
  const htmlPath = repoPath("docs", "starfield", "index.html");

  const js = await Deno.readTextFile(jsPath);
  const html = await Deno.readTextFile(htmlPath);

  assert(
    html.includes('id="backBtn"'),
    `Expected ${htmlPath} to include a Back button`,
  );
  assert(
    html.includes("Backspace/Back"),
    `Expected ${htmlPath} to hint Backspace/Back in the UI`,
  );

  // Minimal behavioural hooks (navigation + visible trail lines).
  assert(
    js.includes("navigateBack") && js.includes("focusTrail"),
    `Expected ${jsPath} to include focus trail navigation state`,
  );
  assert(
    js.includes("appendTrailLines"),
    `Expected ${jsPath} to render a focus trail (path home) as line segments`,
  );
  assert(
    js.includes("computeOutputPathToFocus") &&
      js.includes("appendOutputPathLines"),
    `Expected ${jsPath} to compute and render an output->focus path to reduce clutter`,
  );
});

Deno.test("starfield uses an FPS-like depth bias for initial focus view", async () => {
  const jsPath = repoPath("docs", "starfield", "starfield.js");
  const js = await Deno.readTextFile(jsPath);

  assert(
    js.includes("FPS-like depth bias") || js.includes("first person"),
    `Expected ${jsPath} to document an FPS-like perspective tweak`,
  );
  assert(
    js.includes("-Math.abs(rawZ)"),
    `Expected ${jsPath} to bias Z so non-focus neurons don't appear closer than the focus`,
  );
});
