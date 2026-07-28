/**
 * On-device derived-subgraph cache tests (Issue #561).
 *
 * The cache lets a repeat visit for the same snapshot skip the expensive
 * download → gunzip → parse → rank pipeline. These tests pin the three failure
 * modes the issue calls out — each is the earliest automated detection point
 * for a regression that would otherwise only show up as a stale subgraph or a
 * silently-lost speed-up:
 *
 *  (1) stale cache served — a changed content/version signal must bypass the
 *      cached entry and run the fresh load path;
 *  (2) miss / eviction / corruption must fail open — the normal derivation
 *      completes with no thrown error;
 *  (3) a cache hit for an unchanged key returns a result deep-equal to a fresh
 *      derivation.
 */

import { assert, assertEquals } from "./test_helpers.ts";

import {
  CACHE_SCHEMA_VERSION,
  deriveSubgraphCached,
  fetchVersionSignal,
  fileVersionSignal,
  loadCachedDerivation,
  saveCachedDerivation,
  subgraphCacheKey,
} from "../docs/shared/subgraph_cache.js";
import { deriveSubgraphFromRequest } from "../docs/shared/subgraph_derivation.js";

// deno-lint-ignore no-explicit-any
type Any = any;

/** A minimal in-memory {@link CacheStore} that records get/set calls. */
function memoryStore(seed: Record<string, unknown> = {}) {
  const map = new Map<string, unknown>(Object.entries(seed));
  return {
    map,
    // deno-lint-ignore require-await
    async get(key: string) {
      return map.has(key) ? map.get(key) : null;
    },
    // deno-lint-ignore require-await
    async set(key: string, value: unknown) {
      map.set(key, value);
    },
  };
}

/** A store whose reads/writes always throw, to prove fail-open. */
function faultyStore() {
  return {
    get(_key: string): Promise<unknown> {
      return Promise.reject(new Error("store read exploded"));
    },
    set(_key: string, _value: unknown): Promise<void> {
      return Promise.reject(new Error("store write exploded"));
    },
  };
}

/** A structurally-valid derived result carrying a marker so we can identify it. */
function fakeResult(marker: string): Any {
  return {
    source: { rankedPaths: [{ inputUuid: marker }], model: { nodes: [] } },
    labels: { "input-0": marker },
    descriptions: {},
  };
}

/** The six-observation fixture, shared with subgraph_view_test.ts. */
function fixtureSnapshot(): Any {
  return {
    tooltips: { "input-0": { label: "Cash rate", group: "rates" } },
    creature: {
      input: 6,
      output: 1,
      neurons: [
        { uuid: "hidden-A", type: "hidden", squash: "TANH", bias: 0 },
        { uuid: "hidden-B", type: "hidden", squash: "TANH", bias: 0 },
        { uuid: "hidden-C", type: "hidden", squash: "TANH", bias: 0 },
        { uuid: "output-0", type: "output", squash: "IDENTITY", bias: 0 },
      ],
      synapses: [
        { fromUuid: "input-0", toUuid: "hidden-A", weight: 2 },
        { fromUuid: "input-1", toUuid: "hidden-A", weight: 0.5 },
        { fromUuid: "input-2", toUuid: "hidden-B", weight: 1.5 },
        { fromUuid: "input-3", toUuid: "hidden-B", weight: 0.2 },
        { fromUuid: "input-4", toUuid: "hidden-C", weight: 0.05 },
        { fromUuid: "input-5", toUuid: "hidden-C", weight: 0.01 },
        { fromUuid: "hidden-A", toUuid: "output-0", weight: 1.5 },
        { fromUuid: "hidden-B", toUuid: "output-0", weight: -1 },
        { fromUuid: "hidden-C", toUuid: "output-0", weight: 0.02 },
      ],
    },
  };
}

/** Stable serialisation that survives Maps, for deep-equality assertions. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v instanceof Map) return { __map: [...v.entries()] };
    if (v instanceof Set) return { __set: [...v.values()] };
    return v;
  });
}

// ---------------------------------------------------------------------------
// Keys and signals.
// ---------------------------------------------------------------------------

Deno.test("subgraphCacheKey keys URL and file requests by identity", () => {
  assertEquals(
    subgraphCacheKey({ type: "url", url: "https://x.test/snap.json.gz" }),
    "url:https://x.test/snap.json.gz",
  );
  // The same URL with a redundant dot-segment normalises to the same key.
  assertEquals(
    subgraphCacheKey({ type: "url", url: "data/./snap.json" }),
    subgraphCacheKey({ type: "url", url: "data/snap.json" }),
  );
  assertEquals(
    subgraphCacheKey({ type: "file", file: { name: "snap.json.gz" } }),
    "file:snap.json.gz",
  );
});

Deno.test("fileVersionSignal changes when a re-uploaded file changes", () => {
  const original = fileVersionSignal({
    name: "snap.json",
    size: 100,
    lastModified: 1,
  });
  const edited = fileVersionSignal({
    name: "snap.json",
    size: 120,
    lastModified: 2,
  });
  assert(original && edited, "both files yield a signal");
  assert(original !== edited, "a changed file must change its signal");
  assertEquals(fileVersionSignal(null as Any), null);
});

Deno.test("fetchVersionSignal derives a signal from HEAD validators and fails open", async () => {
  const withEtag = await fetchVersionSignal(
    "https://x.test/snap.json.gz",
    (() =>
      Promise.resolve(
        new Response(null, {
          status: 200,
          headers: { etag: "abc123", "content-length": "999" },
        }),
      )) as Any,
  );
  assert(withEtag?.includes("abc123"), "the ETag drives the signal");

  // A network fault yields null (fail open), never a throw.
  const onError = await fetchVersionSignal(
    "https://x.test/snap.json.gz",
    (() => Promise.reject(new Error("offline"))) as Any,
  );
  assertEquals(onError, null);

  // A host exposing no validator also yields null.
  const noValidator = await fetchVersionSignal(
    "https://x.test/snap.json.gz",
    (() => Promise.resolve(new Response(null, { status: 200 }))) as Any,
  );
  assertEquals(noValidator, null);
});

// ---------------------------------------------------------------------------
// (1) Stale cache served — a changed signal must bypass the cached entry.
// ---------------------------------------------------------------------------

Deno.test("a changed signal invalidates the cache and runs the fresh load path", async () => {
  const store = memoryStore();
  const request = { type: "url", url: "https://x.test/snap.json.gz" };
  let derived = 0;
  const derive = (_req: Any) => {
    derived++;
    return Promise.resolve(fakeResult(`v${derived}`));
  };

  // First visit at signal "etag-1" derives and caches.
  const first = await deriveSubgraphCached({
    request,
    signal: "etag-1",
    derive,
    store,
  });
  assertEquals(first.labels["input-0"], "v1");
  assertEquals(derived, 1);

  // The snapshot changed (new ETag): the cached entry must be bypassed and the
  // fresh path must run rather than serving the stale subgraph.
  const afterChange = await deriveSubgraphCached({
    request,
    signal: "etag-2",
    derive,
    store,
  });
  assertEquals(derived, 2, "a changed signal must re-derive");
  assertEquals(afterChange.labels["input-0"], "v2", "fresh result served");

  // A schema-version bump is likewise treated as stale.
  await store.set(subgraphCacheKey(request), {
    schemaVersion: CACHE_SCHEMA_VERSION + 1,
    signal: "etag-3",
    result: fakeResult("old-schema"),
  });
  const stale = await loadCachedDerivation({
    key: subgraphCacheKey(request),
    signal: "etag-3",
    store,
  });
  assertEquals(stale, null, "an incompatible schema version is a miss");
});

// ---------------------------------------------------------------------------
// (2) Miss / eviction / corruption must fail open.
// ---------------------------------------------------------------------------

Deno.test("an empty cache falls through to the normal derivation without error", async () => {
  const store = memoryStore();
  const request = { type: "url", url: "https://x.test/snap.json.gz" };
  let derived = 0;
  const result = await deriveSubgraphCached({
    request,
    signal: "etag-1",
    derive: (_req: Any) => {
      derived++;
      return Promise.resolve(fakeResult("fresh"));
    },
    store,
  });
  assertEquals(derived, 1, "a miss must run the derivation");
  assertEquals(result.labels["input-0"], "fresh");
  // The fresh result was written back for next time.
  assert(
    store.map.has(subgraphCacheKey(request)),
    "a miss populates the cache",
  );
});

Deno.test("a corrupted cache entry is ignored and the load path still completes", async () => {
  const request = { type: "url", url: "https://x.test/snap.json.gz" };
  const key = subgraphCacheKey(request);
  // An entry whose result is structurally broken (no source) must be treated as
  // a miss, not deserialised into a broken render.
  const store = memoryStore({
    [key]: {
      schemaVersion: CACHE_SCHEMA_VERSION,
      signal: "etag-1",
      result: { garbage: true },
    },
  });

  const hit = await loadCachedDerivation({ key, signal: "etag-1", store });
  assertEquals(hit, null, "a corrupted entry is not a usable hit");

  let derived = 0;
  const result = await deriveSubgraphCached({
    request,
    signal: "etag-1",
    derive: (_req: Any) => {
      derived++;
      return Promise.resolve(fakeResult("recovered"));
    },
    store,
  });
  assertEquals(derived, 1, "a corrupted entry falls open to the derivation");
  assertEquals(result.labels["input-0"], "recovered");
});

Deno.test("a throwing store never breaks the load — reads and writes fail open", async () => {
  const request = { type: "url", url: "https://x.test/snap.json.gz" };
  let derived = 0;
  const result = await deriveSubgraphCached({
    request,
    signal: "etag-1",
    derive: (_req: Any) => {
      derived++;
      return Promise.resolve(fakeResult("survived"));
    },
    store: faultyStore() as Any,
  });
  assertEquals(derived, 1, "a store fault must fall open to the derivation");
  assertEquals(result.labels["input-0"], "survived");

  // saveCachedDerivation must swallow the write fault and report false.
  const saved = await saveCachedDerivation({
    key: "k",
    signal: "etag-1",
    result: fakeResult("x"),
    store: faultyStore() as Any,
  });
  assertEquals(saved, false, "a failed write is reported, never thrown");
});

Deno.test("with no signal the cache is bypassed entirely (no stale risk)", async () => {
  const store = memoryStore();
  const request = { type: "url", url: "https://x.test/snap.json.gz" };
  let derived = 0;
  const derive = (_req: Any) => {
    derived++;
    return Promise.resolve(fakeResult("nosig"));
  };
  await deriveSubgraphCached({ request, signal: null, derive, store });
  await deriveSubgraphCached({ request, signal: null, derive, store });
  assertEquals(derived, 2, "without a signal every visit re-derives");
  assertEquals(
    store.map.size,
    0,
    "nothing is cached that could never be validated",
  );
});

// ---------------------------------------------------------------------------
// (3) Cache hit correctness — a repeat visit deep-equals a fresh derivation.
// ---------------------------------------------------------------------------

Deno.test("a cache hit returns a result deep-equal to a fresh derivation", async () => {
  const gz = await gzip(JSON.stringify(fixtureSnapshot()));
  const savedFetch = globalThis.fetch;
  const okResponse = () =>
    Promise.resolve(
      new Response(gz as Any, {
        status: 200,
        headers: {
          "content-type": "application/gzip",
          "content-length": String(gz.length),
        },
      }),
    );

  try {
    globalThis.fetch = okResponse as Any;
    const request: Any = { type: "url", url: "https://x.test/snap.json.gz" };
    const store = memoryStore();

    // First visit: real derivation, cached under signal "etag-1".
    let derivations = 0;
    const derive = (req: Any) => {
      derivations++;
      return deriveSubgraphFromRequest(req);
    };
    const first = await deriveSubgraphCached({
      request,
      signal: "etag-1",
      derive,
      store,
    });
    assertEquals(derivations, 1);

    // Repeat visit at the same signal: must NOT re-derive.
    let hit = false;
    const second = await deriveSubgraphCached({
      request,
      signal: "etag-1",
      derive,
      store,
      onCacheHit: () => (hit = true),
    });
    assert(hit, "the repeat visit must be a cache hit");
    assertEquals(derivations, 1, "a hit must not run the derivation again");

    // The cached result deep-equals an independent fresh derivation.
    const fresh = await deriveSubgraphFromRequest(request);
    assertEquals(
      canonical(second.source.rankedPaths),
      canonical(fresh.source.rankedPaths),
      "cached ranked paths must equal a fresh derivation",
    );
    assertEquals(
      canonical(second.labels),
      canonical(fresh.labels),
      "cached labels must equal a fresh derivation",
    );
    assertEquals(
      canonical((second.source.model as Any).nodes),
      canonical((fresh.source.model as Any).nodes),
      "cached model nodes must equal a fresh derivation",
    );
    // And equal to the first visit's own result.
    assertEquals(canonical(second), canonical(first));
  } finally {
    globalThis.fetch = savedFetch;
  }
});

/** Gzip a string with the platform CompressionStream (Deno + browsers). */
async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([new TextEncoder().encode(text)]).stream()
    .pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
