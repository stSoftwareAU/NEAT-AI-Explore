function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  // .../tests/snapshot_url_param_test.ts -> repo root
  const root = here.replace(/\/tests\/snapshot_url_param_test\.ts$/, "");
  return [root, ...parts].join("/");
}

Deno.test("app supports snapshotUrl and snapshotUrlB64 query parameters", async () => {
  const p = repoPath("docs", "app.js");
  const js = await Deno.readTextFile(p);

  // Backwards compat + new URL param name.
  assert(
    js.includes('params.get("file")'),
    `Expected ${p} to continue supporting ?file=...`,
  );
  assert(
    js.includes('params.get("snapshotUrl")'),
    `Expected ${p} to support ?snapshotUrl=...`,
  );

  // Presigned URL safe transport.
  assert(
    js.includes('params.get("snapshotUrlB64")'),
    `Expected ${p} to support ?snapshotUrlB64=...`,
  );
  assert(
    js.includes("decodeBase64UrlToUtf8"),
    `Expected ${p} to include base64url decode helper`,
  );
});
