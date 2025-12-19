function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  // .../tests/service_worker_gzip_cache_test.ts -> repo root
  const root = here.replace(/\/tests\/service_worker_gzip_cache_test\.ts$/, "");
  return [root, ...parts].join("/");
}

Deno.test("service worker treats .json.gz snapshots as runtime (network-first) content", async () => {
  const p = repoPath("docs", "sw.js");
  const js = await Deno.readTextFile(p);

  // In GitHub Pages, snapshots are often stored as snapshot.json.gz. We want the
  // runtime cache strategy (network-first with cache fallback) to cover them,
  // so the PWA can reopen previously loaded snapshots offline.
  assert(
    js.includes('url.pathname.endsWith(".json.gz")'),
    `Expected ${p} to recognise .json.gz as a snapshot request`,
  );
});
