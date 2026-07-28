/**
 * Off-main-thread subgraph derivation (Issue #560).
 *
 * The single, DOM-free pipeline that turns a snapshot request into the
 * everything-the-view-needs result: download → gunzip → parse → rank. It runs
 * inside the Web Worker (`docs/subgraph/subgraph_worker.js`) so the heavy
 * `buildSubgraphSource` ranking never blocks the main thread, and it is reused
 * verbatim as the legacy main-thread fallback for browsers without module
 * Worker support. Keeping it here — free of `document`/`self` — means it is
 * testable directly under Deno.
 *
 * Failures are surfaced, never swallowed (Issue #3234): a fetch that never
 * succeeds re-throws the last error, and `buildSubgraphSource` throws loudly on
 * an unusable snapshot.
 *
 * @module
 */

import { fetchSnapshotJson, readSnapshotFile } from "./snapshot_loader.js";
import { buildSubgraphSource } from "./subgraph_model.js";
import { extractTooltips } from "./ui_helpers.js";

/**
 * @typedef {object} SubgraphRequest
 * @property {"url"|"file"} type
 * @property {string} [url] — snapshot URL (type "url").
 * @property {string[]} [fallbacks] — mirror URLs to try if `url` fails.
 * @property {File} [file] — local snapshot file (type "file").
 */

/**
 * @typedef {object} DerivationHandlers
 * @property {(phase: "download"|"gunzip"|"parse"|"rank") => void} [onPhase]
 * @property {(p: import("./snapshot_loader.js").FetchProgress) => void} [onProgress]
 */

/**
 * Run the full derivation for a request, reporting each phase honestly.
 *
 * @param {SubgraphRequest} request
 * @param {DerivationHandlers} [handlers]
 * @returns {Promise<{
 *   source: ReturnType<typeof buildSubgraphSource>,
 *   labels: Record<string, string>,
 *   descriptions: Record<string, string>,
 * }>}
 */
export async function deriveSubgraphFromRequest(request, handlers = {}) {
  const onPhase = handlers?.onPhase;
  const onProgress = handlers?.onProgress;

  let snapshot;
  if (request?.type === "file") {
    snapshot = await readSnapshotFile(request.file, { onPhase });
  } else {
    // Try the primary URL then any fallbacks in order — the fallback sweep runs
    // off the main thread with the rest of the download (Issue #560).
    const urls = [request?.url, ...(request?.fallbacks ?? [])].filter(Boolean);
    if (urls.length === 0) {
      throw new Error("deriveSubgraphFromRequest: no snapshot URL provided");
    }
    let lastError = null;
    snapshot = undefined;
    for (const url of urls) {
      try {
        snapshot = await fetchSnapshotJson(url, { onProgress, onPhase });
        lastError = null;
        break;
      } catch (e) {
        lastError = e;
        snapshot = undefined;
      }
    }
    if (snapshot === undefined) {
      // Fail loud: never present a failed download as an empty result.
      throw lastError ??
        new Error(`Could not load the snapshot from ${request?.url}`);
    }
  }

  // The ranking is the expensive step this whole exercise moves off the main
  // thread. `buildSubgraphSource` throws loudly on an unusable snapshot.
  if (onPhase) onPhase("rank");
  const source = buildSubgraphSource(snapshot);
  const { labels, descriptions } = extractTooltips(snapshot);
  return { source, labels, descriptions };
}
