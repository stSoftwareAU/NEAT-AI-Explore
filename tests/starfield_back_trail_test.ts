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

function countOccurrences(haystack: string, needle: string): number {
  let n = 0;
  let i = 0;
  while (true) {
    const j = haystack.indexOf(needle, i);
    if (j < 0) return n;
    n++;
    i = j + needle.length;
  }
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
    `Expected ${jsPath} to define an appendTrailLines helper`,
  );

  // Ensure the trail is actually rendered (not just defined).
  const start = js.indexOf("renderer.onFocusChanged = (idx, m");
  assert(start >= 0, `Expected ${jsPath} to assign renderer.onFocusChanged`);
  const endMarker = "buildHudForIndex(-1);";
  const end = js.indexOf(endMarker, start);
  assert(
    end > start,
    `Expected ${jsPath} to include ${endMarker} after handler`,
  );
  const handler = js.slice(start, end);
  const calls = countOccurrences(handler, "appendTrailLines({");
  assert(
    calls >= 1,
    `Expected onFocusChanged to call appendTrailLines({ at least once; found ${calls}.`,
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
