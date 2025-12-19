function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  // .../tests/generate_pwa_assets_fallback_test.ts -> repo root
  const root = here.replace(
    /\/tests\/generate_pwa_assets_fallback_test\.ts$/,
    "",
  );
  return [root, ...parts].join("/");
}

Deno.test("generate_pwa_assets.py fallback placeholders cover README screenshots", async () => {
  const p = repoPath("scripts", "generate_pwa_assets.py");
  const py = await Deno.readTextFile(p);

  // We intentionally validate the *fallback* block, because CI/dev machines may
  // not have Playwright installed. In that case, we still want the README image
  // links (and PWA manifest metadata) to point at existing files.
  const m = py.match(/except Exception:\n([\s\S]*?)\n\s*return\b/);
  assert(
    m,
    `Expected ${p} to include an 'except Exception' fallback with a return`,
  );

  const fallback = m[1];
  for (
    const expected of [
      "desktop-screenshot.png",
      "mobile-screenshot.png",
      "ipad-screenshot.png",
      "iphone-screenshot.png",
      "iphone-inbound-modal.png",
      "ipad-inbound-modal.png",
      "desktop-inbound-modal.png",
    ]
  ) {
    assert(
      fallback.includes(expected),
      `Expected Playwright-missing fallback to generate ${expected}`,
    );
  }
});
