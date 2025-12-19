/**
 * Test that progress indicators are present and functional for large file loading.
 */

function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  const root = here.replace(/\/tests\/progress_indicator_test\.ts$/, "");
  return [root, ...parts].join("/");
}

Deno.test("index.html contains progress bar element", async () => {
  for (const p of [repoPath("index.html"), repoPath("docs", "index.html")]) {
    const html = await Deno.readTextFile(p);
    assert(
      html.includes('id="progressContainer"') ||
        html.includes("id='progressContainer'"),
      `Expected ${p} to contain a progress container element`,
    );
    assert(
      html.includes('id="progressBar"') || html.includes("id='progressBar'"),
      `Expected ${p} to contain a progress bar element`,
    );
  }
});

Deno.test("styles.css contains progress bar styles", async () => {
  for (const p of [repoPath("styles.css"), repoPath("docs", "styles.css")]) {
    const css = await Deno.readTextFile(p);
    assert(
      css.includes(".progressContainer"),
      `Expected ${p} to contain .progressContainer styles`,
    );
    assert(
      css.includes(".progressBar"),
      `Expected ${p} to contain .progressBar styles`,
    );
  }
});

Deno.test("app.js shows and updates progress during fetch", async () => {
  for (const p of [repoPath("app.js"), repoPath("docs", "app.js")]) {
    const js = await Deno.readTextFile(p);
    assert(
      js.includes("progressContainer") && js.includes("progressBar"),
      `Expected ${p} to reference progress bar elements`,
    );
    assert(
      js.includes("showProgress") || js.includes("updateProgress"),
      `Expected ${p} to have progress update functions`,
    );
    // Should read content-length for progress calculation
    assert(
      js.includes("content-length") || js.includes("Content-Length"),
      `Expected ${p} to read content-length header for progress`,
    );
  }
});
