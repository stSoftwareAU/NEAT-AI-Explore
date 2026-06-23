import { assert, assertEquals } from "./test_helpers.ts";

import { fetchSnapshotJson } from "../docs/shared/snapshot_loader.js";

// --- fetchSnapshotJson ---
//
// WHAT-tests for the orchestrating fetch (Issue #372). We stub
// `globalThis.fetch` and assert only on observable behaviour (return values
// and `onProgress` callbacks), never on internal call order.

/**
 * Run `fn` with `globalThis.fetch` temporarily replaced by `stub`, restoring
 * the original afterwards regardless of outcome.
 */
async function withFetch<T>(
  stub: typeof globalThis.fetch,
  fn: () => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

/**
 * Run `fn` with `globalThis.setTimeout` replaced by an immediate scheduler so
 * the exponential-backoff retry path does not actually wait. Restores the
 * original afterwards.
 */
async function withoutDelay<T>(fn: () => Promise<T>): Promise<T> {
  const original = globalThis.setTimeout;
  globalThis.setTimeout = ((cb: (...a: unknown[]) => void) => {
    cb();
    return 0;
  }) as unknown as typeof globalThis.setTimeout;
  try {
    return await fn();
  } finally {
    globalThis.setTimeout = original;
  }
}

/** Build a streaming Response that emits `chunks` and reports content-length. */
function streamingResponse(
  chunks: Uint8Array[],
  headers: Record<string, string>,
): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers });
}

Deno.test("fetchSnapshotJson happy path returns parsed JSON", async () => {
  const payload = { meta: { version: "1.0" }, nodes: [1, 2, 3] };
  const stub = () =>
    Promise.resolve(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  const result = await withFetch(
    stub as typeof globalThis.fetch,
    () => fetchSnapshotJson("snapshot.json"),
  );
  assertEquals(JSON.stringify(result), JSON.stringify(payload));
});

Deno.test("fetchSnapshotJson absorbs a transient failure then succeeds", async () => {
  const payload = { ok: true };
  let calls = 0;
  const stub = () => {
    calls++;
    if (calls === 1) return Promise.reject(new TypeError("network down"));
    return Promise.resolve(
      new Response(JSON.stringify(payload), { status: 200 }),
    );
  };
  const result = await withoutDelay(() =>
    withFetch(
      stub as typeof globalThis.fetch,
      () => fetchSnapshotJson("snapshot.json"),
    )
  );
  assertEquals(JSON.stringify(result), JSON.stringify(payload));
  assert(calls >= 2, "fetch should have been retried after the first failure");
});

Deno.test("fetchSnapshotJson throws on HTTP error status", async () => {
  const stub = () => Promise.resolve(new Response(null, { status: 503 }));
  let threw = false;
  try {
    await withFetch(
      stub as typeof globalThis.fetch,
      () => fetchSnapshotJson("snapshot.json"),
    );
  } catch (e) {
    threw = true;
    assert(e instanceof Error, "should throw an Error");
    assertEquals((e as Error).message, "HTTP 503");
  }
  assert(threw, "expected fetchSnapshotJson to throw on a 503 response");
});

Deno.test("fetchSnapshotJson client-side decompresses a .gz response", async () => {
  const payload = { meta: { compressed: true } };
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  const compressedStream = new Blob([encoded]).stream().pipeThrough(
    new CompressionStream("gzip"),
  );
  const compressed = new Uint8Array(
    await new Response(compressedStream).arrayBuffer(),
  );
  // .gz URL, but NO `content-encoding: gzip` header -> needs client decompress.
  const stub = () =>
    Promise.resolve(
      streamingResponse([compressed], {
        "content-length": String(compressed.length),
      }),
    );
  const result = await withFetch(
    stub as typeof globalThis.fetch,
    () => fetchSnapshotJson("snapshot.json.gz"),
  );
  assertEquals(JSON.stringify(result), JSON.stringify(payload));
});

Deno.test("fetchSnapshotJson reports monotonically increasing progress", async () => {
  const payload = { values: [1, 2, 3, 4, 5] };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const mid = Math.floor(bytes.length / 2);
  const chunks = [bytes.slice(0, mid), bytes.slice(mid)];
  const total = bytes.length;
  const stub = () =>
    Promise.resolve(
      streamingResponse(chunks, {
        "content-length": String(total),
        "content-type": "application/json",
      }),
    );

  const received: number[] = [];
  const result = await withFetch(
    stub as typeof globalThis.fetch,
    () =>
      fetchSnapshotJson("snapshot.json", {
        onProgress: (p) => received.push(p.receivedBytes),
      }),
  );

  assertEquals(JSON.stringify(result), JSON.stringify(payload));
  assert(received.length >= 2, "onProgress should fire more than once");
  for (let i = 1; i < received.length; i++) {
    assert(
      received[i] >= received[i - 1],
      `receivedBytes must be non-decreasing (saw ${received[i - 1]} -> ${
        received[i]
      })`,
    );
  }
  assertEquals(received[received.length - 1], total);
});
