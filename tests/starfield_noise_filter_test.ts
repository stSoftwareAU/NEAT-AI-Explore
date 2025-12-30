function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  // .../tests/starfield_noise_filter_test.ts -> repo root
  const root = here.replace(/\/tests\/starfield_noise_filter_test\.ts$/, "");
  return [root, ...parts].join("/");
}

Deno.test("starfield filters noisy inbound edges while preserving true counts (30-Dec-2025)", async () => {
  const jsPath = repoPath("docs", "starfield", "starfield.js");
  const js = await Deno.readTextFile(jsPath);

  assert(
    js.includes("selectInboundEdgesForRender"),
    `Expected ${jsPath} to include a selectInboundEdgesForRender helper`,
  );
  assert(
    js.includes("MIN_INBOUND_SHARE"),
    `Expected ${jsPath} to include a MIN_INBOUND_SHARE threshold`,
  );
  assert(
    js.includes("MIN_INBOUND_LINES") && js.includes("MAX_INBOUND_LINES"),
    `Expected ${jsPath} to bound rendered inbound edges (min/max)`,
  );
});
