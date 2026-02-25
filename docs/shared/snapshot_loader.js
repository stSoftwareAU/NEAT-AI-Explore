/**
 * Shared snapshot loader utilities (browser-side).
 *
 * Used by multiple views (Explorer + Starfield) to avoid duplicating tricky
 * behaviours like gzip decoding, progress reporting, and safe URL normalisation.
 *
 * Australian English note:
 * - Keep spellings like "colour", "behaviour".
 *
 * Last updated: 30-Dec-2025
 */

/**
 * Normalise dot-segments for relative paths. Some hosts/CDNs treat "/./x" as a
 * different resource path rather than normalising it.
 * @param {string} inputUrl
 * @returns {string}
 */
export function normaliseSnapshotUrl(inputUrl) {
  const raw = String(inputUrl ?? "").trim();
  if (!raw) return raw;

  // Don't touch absolute URLs (including blob: for file picker flows).
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) return raw;

  let u = raw;
  while (u.startsWith("./")) u = u.slice(2);
  u = u.replaceAll("/./", "/");
  return u;
}

/**
 * Base64url decode for query params (avoids percent-encoding long presigned URLs).
 * RFC 4648 §5.
 * @param {string} base64Url
 * @returns {string|null}
 */
export function decodeBase64UrlToUtf8(base64Url) {
  try {
    const base64 = String(base64Url).replaceAll("-", "+").replaceAll("_", "/");
    const pad = "=".repeat((4 - (base64.length % 4)) % 4);
    const bin = atob(base64 + pad);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch (_e) {
    return null;
  }
}

/**
 * @param {unknown} s
 * @returns {boolean}
 */
export function isDangerousUrlScheme(s) {
  const v = String(s ?? "").trim().toLowerCase();
  return v.startsWith("javascript:") || v.startsWith("data:");
}

/**
 * Compute the retry delay for a given attempt using exponential backoff,
 * capped at 30 seconds (Issue #118).
 *
 * @param {number} attempt - Zero-based attempt index.
 * @param {number} baseDelayMs - Base delay in milliseconds.
 * @returns {number} Delay in milliseconds.
 */
export function computeRetryDelayMs(attempt, baseDelayMs) {
  const MAX_DELAY_MS = 30000;
  return Math.min(baseDelayMs * Math.pow(2, attempt), MAX_DELAY_MS);
}

/**
 * @param {Uint8Array} gzBytes
 * @returns {Promise<string>}
 */
export async function gunzipToText(gzBytes) {
  // Prefer the native streaming API when available (modern Chromium/Firefox).
  // Safari/iOS can still lack DecompressionStream, so fall back to a small JS
  // implementation (vendored in ../vendor/fflate.browser.js).
  if (typeof DecompressionStream !== "undefined") {
    try {
      const stream = new Blob([gzBytes]).stream().pipeThrough(
        new DecompressionStream("gzip"),
      );
      return await new Response(stream).text();
    } catch (_e) {
      // Fall through to JS gunzip.
    }
  }

  try {
    const { gunzipSync } = await import("../vendor/fflate.browser.js");
    const out = gunzipSync(gzBytes);
    return new TextDecoder().decode(out);
  } catch (_e) {
    throw new Error(
      "This snapshot is gzipped (.gz) but this browser can't decompress it. Export/upload an uncompressed .json, or use a browser with gzip support.",
    );
  }
}

/**
 * @typedef {object} FetchProgress
 * @property {number|null} totalBytes
 * @property {number} receivedBytes
 * @property {boolean} indeterminate
 */

// Maximum number of retry attempts for transient network failures (Issue #67).
// The first fetch can fail during Service Worker activation or on unstable
// connections. Automatic retries make the app more resilient.
const FETCH_MAX_RETRIES = 2;

// Initial delay (ms) before the first retry. Doubles on each subsequent retry
// (exponential backoff) to give transient issues time to resolve.
const FETCH_RETRY_DELAY_MS = 500;

/**
 * Fetch and parse snapshot JSON, with optional gzip decode and progress reporting.
 *
 * Notes:
 * - This is a best-effort loader for a debug PWA; it prefers compatibility and
 *   clear errors over cleverness.
 * - Network-first with retry: retries on transient network failures (Issue #67).
 *
 * @param {string} url
 * @param {{
 *   onProgress?: (p: FetchProgress) => void,
 * }} [opts]
 * @returns {Promise<any>}
 */
export async function fetchSnapshotJson(url, opts = {}) {
  const u = normaliseSnapshotUrl(url);
  const onProgress = opts?.onProgress ?? null;

  /** @type {(p: FetchProgress) => void} */
  const report = (p) => {
    try {
      if (onProgress) onProgress(p);
    } catch (_e) {
      // Non-fatal: progress callbacks should not break loading.
    }
  };

  // Network-first with retry: attempt the fetch, retrying on transient network
  // failures (Issue #67). This handles the common "first fetch fails, second
  // works" scenario during Service Worker activation or on unstable mobile
  // connections.
  let res;
  let _lastError = null;
  for (let attempt = 0; attempt <= FETCH_MAX_RETRIES; attempt++) {
    try {
      res = await fetch(u, { cache: "no-cache" });
      _lastError = null;
      break;
    } catch (e) {
      _lastError = e;
      // If this wasn't our last attempt, wait before retrying (exponential backoff).
      if (attempt < FETCH_MAX_RETRIES) {
        const delay = FETCH_RETRY_DELAY_MS * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw e;
    }
  }

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const ce = (res.headers.get("content-encoding") ?? "").toLowerCase();
  const ct = (res.headers.get("content-type") ?? "").toLowerCase();
  const contentLength = res.headers.get("content-length");
  const totalBytes = contentLength ? parseInt(contentLength, 10) : null;

  const looksGz = String(u).toLowerCase().includes(".gz") ||
    ct.includes("gzip") || ct.includes("application/x-gzip");
  const needsClientDecompress = looksGz && !ce.includes("gzip");

  // Stream the response to track download progress.
  if (res.body && (totalBytes || needsClientDecompress)) {
    const reader = res.body.getReader();
    const chunks = [];
    let receivedBytes = 0;

    report({
      totalBytes,
      receivedBytes: 0,
      indeterminate: !totalBytes,
    });

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      receivedBytes += value.length;
      report({
        totalBytes,
        receivedBytes,
        indeterminate: !totalBytes,
      });
    }

    // Combine chunks into a single buffer
    const allChunks = new Uint8Array(receivedBytes);
    let position = 0;
    for (const chunk of chunks) {
      allChunks.set(chunk, position);
      position += chunk.length;
    }

    if (needsClientDecompress) {
      const text = await gunzipToText(allChunks);
      return JSON.parse(text);
    }

    const text = new TextDecoder().decode(allChunks);
    return JSON.parse(text);
  }

  // Fallback: no streaming (e.g., body unavailable)
  if (looksGz && !ce.includes("gzip")) {
    const buf = new Uint8Array(await res.arrayBuffer());
    const text = await gunzipToText(buf);
    return JSON.parse(text);
  }

  return await res.json();
}

/**
 * Read a local file from an <input type="file"> and parse as snapshot JSON.
 * Supports .gz via gunzip.
 *
 * @param {File} file
 * @returns {Promise<any>}
 */
export async function readSnapshotFile(file) {
  const name = String(file?.name ?? "");
  if (name.toLowerCase().endsWith(".gz")) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const text = await gunzipToText(buf);
    return JSON.parse(text);
  }
  const text = await file.text();
  return JSON.parse(text);
}
