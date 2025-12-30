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

Deno.test("app defaults to loading snapshot.json.gz (no leading ./)", async () => {
  const p = repoPath("docs", "app.js");
  const js = await Deno.readTextFile(p);
  assert(
    js.includes(
      'const DEFAULT_SNAPSHOT_URL =\n  "https://stsoftwareau.github.io/NEAT-AI-Snapshot/snapshot.json.gz";',
    ),
    `Expected ${p} to default to the NEAT-AI-Snapshot GitHub Pages URL`,
  );
  assert(
    !js.includes('const DEFAULT_SNAPSHOT_URL = "./snapshot.json.gz";'),
    `Did not expect ${p} to default to "./snapshot.json.gz" (some static hosts treat "/./file" as distinct)`,
  );
});
