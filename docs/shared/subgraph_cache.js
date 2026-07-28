/**
 * On-device cache for the parsed/derived subgraph result (Issue #561).
 *
 * Sub-issue of #553: the exhaustive attribution walk in `buildSubgraphSource`
 * can take minutes on a large snapshot. This module lets a repeat visit for the
 * *same* snapshot skip the whole download → gunzip → parse → rank pipeline by
 * reusing a previously derived result, so the view reaches interactive nearly
 * instantly.
 *
 * Design goals (from the issue):
 *  - **Key on identity + a content/version signal.** The cache key is the
 *    snapshot's identity (URL or uploaded-file name); freshness is decided by a
 *    separately-supplied `signal` (an ETag / Last-Modified for URLs, or file
 *    size + mtime for uploads). A changed signal means the cached entry is
 *    stale and is bypassed, so a stale subgraph is never shown.
 *  - **Fail open.** A cache miss, an eviction, a corrupted entry, or any store
 *    fault falls back to the normal derivation with no thrown error. The cache
 *    can only ever make a repeat visit faster, never break a first visit.
 *
 * The module is DOM-free and side-effect-free so it is testable directly under
 * Deno: the storage backend and the `derive` function are injected. The browser
 * wires in an IndexedDB store (`createIndexedDbStore`) and the real derivation.
 *
 * @module
 */

import { normaliseSnapshotUrl } from "./snapshot_loader.js";

/**
 * Bump when the shape of the derived result changes so entries written by an
 * older build are treated as a miss rather than deserialised into a stale or
 * incompatible shape.
 */
export const CACHE_SCHEMA_VERSION = 1;

/**
 * @typedef {object} DerivationResult
 * @property {{ rankedPaths: unknown[], model: object }} source
 * @property {Record<string, string>} labels
 * @property {Record<string, string>} descriptions
 */

/**
 * @typedef {object} CacheStore
 * @property {(key: string) => Promise<unknown>} get
 * @property {(key: string, value: unknown) => Promise<void>} set
 */

/**
 * Canonical cache key for a request's *identity* — not its content. Two visits
 * to the same URL (or the same uploaded file name) share a key; the `signal`
 * decides whether the stored entry is still fresh.
 *
 * @param {{ type?: string, url?: string, file?: { name?: string } }} request
 * @returns {string}
 */
export function subgraphCacheKey(request) {
  if (request?.type === "file") {
    return `file:${String(request?.file?.name ?? "")}`;
  }
  return `url:${normaliseSnapshotUrl(request?.url ?? "")}`;
}

/**
 * A version signal for an uploaded file: name + size + last-modified time. Any
 * edit changes the size or mtime, so a re-uploaded-but-changed file misses the
 * cache. Returns null when the metadata is unusable so the caller does not
 * cache something it cannot later validate.
 *
 * @param {{ name?: string, size?: number, lastModified?: number }} file
 * @returns {string|null}
 */
export function fileVersionSignal(file) {
  if (!file) return null;
  const parts = [file.name, file.size, file.lastModified]
    .filter((v) => v != null && v !== "");
  return parts.length ? parts.join("|") : null;
}

/**
 * Fetch a cheap content/version signal for a URL without downloading the body:
 * a HEAD request's ETag / Last-Modified (falling back to Content-Length)
 * identifies the snapshot content. Returns null on any failure or when the host
 * exposes no validator, so the caller falls back to the normal load (fail
 * open) rather than risking a stale hit.
 *
 * @param {string} url
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<string|null>}
 */
export async function fetchVersionSignal(url, fetchImpl = globalThis.fetch) {
  const u = normaliseSnapshotUrl(url);
  if (!u || typeof fetchImpl !== "function") return null;
  try {
    const res = await fetchImpl(u, { method: "HEAD", cache: "no-cache" });
    if (!res?.ok) return null;
    const etag = res.headers?.get?.("etag");
    const lastMod = res.headers?.get?.("last-modified");
    const len = res.headers?.get?.("content-length");
    const parts = [etag, lastMod, len].filter(Boolean);
    return parts.length ? parts.join("|") : null;
  } catch (_e) {
    // Fail open: no signal means the caller re-derives normally.
    return null;
  }
}

/** True when a value has the shape the view needs from a derivation. */
function isUsableResult(value) {
  return Boolean(value) &&
    Boolean(value?.source) &&
    Array.isArray(value?.source?.rankedPaths) &&
    Boolean(value?.source?.model) &&
    Boolean(value?.labels) &&
    Boolean(value?.descriptions);
}

/**
 * Read a derived result from the store, returning it only when the entry is
 * present, schema-compatible, matches the current `signal`, and is structurally
 * usable. Every other case — miss, stale signal, schema drift, corruption, or a
 * store fault — returns null (fail open); it never throws.
 *
 * @param {{ key: string, signal: string|null, store: CacheStore }} args
 * @returns {Promise<DerivationResult|null>}
 */
export async function loadCachedDerivation({ key, signal, store }) {
  if (!store || !signal) return null;
  try {
    const entry = await store.get(key);
    if (!entry) return null;
    if (entry.schemaVersion !== CACHE_SCHEMA_VERSION) return null;
    // A changed signal means the snapshot changed: bypass the stale entry so a
    // stale subgraph is never rendered (Issue #561 invalidation requirement).
    if (entry.signal !== signal) return null;
    if (!isUsableResult(entry.result)) return null;
    return entry.result;
  } catch (_e) {
    // Fail open on any read/deserialise fault.
    return null;
  }
}

/**
 * Store a derived result under `key`, tagged with the schema version and the
 * `signal` used to validate it later. Best-effort: a missing signal, an
 * unusable result, or any store fault (quota, private mode) is swallowed and
 * reported via the boolean return — a cache write must never break a load.
 *
 * @param {{ key: string, signal: string|null, result: DerivationResult, store: CacheStore }} args
 * @returns {Promise<boolean>}
 */
export async function saveCachedDerivation({ key, signal, result, store }) {
  // Without a signal we could never validate freshness, so caching would risk a
  // permanent stale hit — decline instead.
  if (!store || !signal || !isUsableResult(result)) return false;
  try {
    await store.set(key, {
      schemaVersion: CACHE_SCHEMA_VERSION,
      signal,
      result,
    });
    return true;
  } catch (_e) {
    // Fail open: a failed write just means the next visit re-derives.
    return false;
  }
}

/**
 * Derive the subgraph for a request, serving a cached result on a fresh repeat
 * visit and otherwise running `derive` and caching its output.
 *
 * Fail-open by construction: with no store or no signal it degrades to a plain
 * `derive(request, handlers)` call, and any cache fault falls through to the
 * same path.
 *
 * @param {{
 *   request: object,
 *   signal: string|null,
 *   derive: (request: object, handlers?: object) => Promise<DerivationResult>,
 *   store?: CacheStore|null,
 *   handlers?: object,
 *   onCacheHit?: () => void,
 * }} args
 * @returns {Promise<DerivationResult>}
 */
export async function deriveSubgraphCached(
  { request, signal, derive, store, handlers, onCacheHit },
) {
  const key = subgraphCacheKey(request);

  const cached = await loadCachedDerivation({ key, signal, store });
  if (cached) {
    onCacheHit?.();
    return cached;
  }

  const result = await derive(request, handlers);
  // Best-effort write; never blocks or breaks the returned result.
  await saveCachedDerivation({ key, signal, result, store });
  return result;
}

/**
 * IndexedDB-backed {@link CacheStore} for the browser. Returns null where
 * IndexedDB is unavailable (older Safari private mode, non-browser runtimes
 * such as Deno) so the caller transparently runs without a cache.
 *
 * The derived result is a structured-cloneable object (plain data plus Maps),
 * which IndexedDB stores natively — unlike Cache Storage, which only holds HTTP
 * responses, so it suits this non-HTTP artefact.
 *
 * @param {string} [dbName]
 * @param {string} [storeName]
 * @returns {CacheStore|null}
 */
export function createIndexedDbStore(
  dbName = "neat-subgraph-cache",
  storeName = "derived",
) {
  if (typeof indexedDB === "undefined") return null;

  const openDb = () =>
    new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

  return {
    async get(key) {
      const db = await openDb();
      try {
        return await new Promise((resolve, reject) => {
          const tx = db.transaction(storeName, "readonly");
          const req = tx.objectStore(storeName).get(key);
          req.onsuccess = () => resolve(req.result ?? null);
          req.onerror = () => reject(req.error);
        });
      } finally {
        db.close?.();
      }
    },
    async set(key, value) {
      const db = await openDb();
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(storeName, "readwrite");
          tx.objectStore(storeName).put(value, key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
      } finally {
        db.close?.();
      }
    },
  };
}
