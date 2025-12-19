function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  // .../tests/gzip_snapshot_support_test.ts -> repo root
  const root = here.replace(/\/tests\/gzip_snapshot_support_test\.ts$/, "");
  return [root, ...parts].join("/");
}

Deno.test("app supports loading gzipped snapshots (.json.gz)", async () => {
  const p = repoPath("docs", "app.js");
  const js = await Deno.readTextFile(p);
  assert(
    js.includes('new DecompressionStream("gzip")'),
    `Expected ${p} to use DecompressionStream('gzip') for .gz snapshots`,
  );
  assert(
    js.includes(".arrayBuffer()"),
    `Expected ${p} to read gz payloads via arrayBuffer()`,
  );
});
