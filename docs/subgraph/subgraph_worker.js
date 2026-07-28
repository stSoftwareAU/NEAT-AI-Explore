/**
 * Subgraph derivation Web Worker (Issue #560).
 *
 * Runs the whole heavy pipeline — download → gunzip → parse → rank — off the
 * main thread so the top-impact subgraph page stays interactive on a phone
 * while a 15.9 MB gzipped snapshot is fetched and ranked. The page posts a
 * request (a URL with optional fallbacks, or an uploaded File) and this worker
 * streams back honest phase/progress messages, then a single `done` message
 * carrying the ranked source and the observation tooltips.
 *
 * All the real work lives in the DOM-free `deriveSubgraphFromRequest` pipeline
 * so it is shared with the legacy main-thread fallback and unit-tested directly.
 */

import { deriveSubgraphFromRequest } from "../shared/subgraph_derivation.js";

/** @param {"download"|"gunzip"|"parse"|"rank"} phase */
function postPhase(phase) {
  self.postMessage({ type: "phase", phase });
}

/** @param {import("../shared/snapshot_loader.js").FetchProgress} p */
function postProgress(p) {
  self.postMessage({
    type: "progress",
    phase: "download",
    receivedBytes: p?.receivedBytes ?? 0,
    totalBytes: p?.totalBytes ?? null,
    indeterminate: p?.indeterminate ?? false,
  });
}

self.onmessage = async (event) => {
  try {
    const result = await deriveSubgraphFromRequest(event.data, {
      onPhase: postPhase,
      onProgress: postProgress,
    });
    self.postMessage({ type: "done", result });
  } catch (e) {
    // Fail loud: hand the page a clear error instead of a silent stall
    // (Issue #3234) — the page turns this into a visible red status.
    self.postMessage({
      type: "error",
      message: e?.message ?? String(e),
    });
  }
};
