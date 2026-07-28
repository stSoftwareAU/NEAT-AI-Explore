/**
 * Main-thread client for the subgraph derivation Web Worker (Issue #560).
 *
 * The page never runs `buildSubgraphSource` itself on the hot path: it posts a
 * request to the worker and awaits a `done` message carrying the ranked source.
 * This module owns that message round-trip and the honest phase → percent
 * mapping, and is DOM-free so it can be driven by a fake worker under Deno.
 *
 * @module
 */

/** The derivation phases, in the order the worker reports them. */
export const SUBGRAPH_PHASES = ["download", "gunzip", "parse", "rank"];

/** Human-readable status text for each phase. */
export const SUBGRAPH_PHASE_LABELS = {
  download: "Downloading the snapshot…",
  gunzip: "Decompressing…",
  parse: "Parsing the network…",
  rank: "Ranking contributions to the Score…",
};

/**
 * Each phase owns a contiguous slice of the 0..1 progress bar. The slices are
 * ordered and non-overlapping so progress only ever moves forward as the worker
 * walks download → gunzip → parse → rank — no fake motion, no going backwards.
 */
const PHASE_RANGES = {
  download: [0, 0.6],
  gunzip: [0.6, 0.75],
  parse: [0.75, 0.9],
  rank: [0.9, 1],
};

/**
 * Map a phase (and optional 0..1 within-phase fraction) to an honest overall
 * percentage for the progress bar.
 *
 * @param {"download"|"gunzip"|"parse"|"rank"} phase
 * @param {number} [fraction] — progress within the phase, 0..1.
 * @returns {number} integer percentage, 0..100.
 */
export function phaseProgressPercent(phase, fraction = 0) {
  const range = PHASE_RANGES[phase];
  if (!range) return 0;
  const f = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
  const [lo, hi] = range;
  return Math.round((lo + (hi - lo) * f) * 100);
}

/**
 * Drive one derivation on a worker-like object and resolve with its result.
 *
 * `worker` need only implement the structured-worker surface this uses:
 * `addEventListener`/`removeEventListener` (or `onmessage`/`onerror`) and
 * `postMessage`. A real `Worker` satisfies it; so does a test double.
 *
 * The promise resolves with the worker's `done` payload — proving the heavy
 * derivation came back across the worker boundary rather than being computed on
 * the calling thread. It rejects loudly on a worker `error` message, an `error`
 * event, or a failed `postMessage`; it never resolves silently on failure
 * (Issue #3234).
 *
 * @param {{
 *   postMessage: (msg: unknown) => void,
 *   addEventListener?: (type: string, listener: (ev: unknown) => void) => void,
 *   removeEventListener?: (type: string, listener: (ev: unknown) => void) => void,
 * }} worker
 * @param {import("./subgraph_derivation.js").SubgraphRequest} request
 * @param {{
 *   onPhase?: (phase: string) => void,
 *   onProgress?: (p: { receivedBytes: number, totalBytes: number|null }) => void,
 * }} [handlers]
 * @returns {Promise<any>}
 */
export function runSubgraphDerivation(worker, request, handlers = {}) {
  const { onPhase, onProgress } = handlers;

  return new Promise((resolve, reject) => {
    let settled = false;

    const detach = () => {
      if (worker.removeEventListener) {
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onWorkerError);
        worker.removeEventListener("messageerror", onWorkerError);
      } else {
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
      }
    };

    const settle = (fn) => (value) => {
      if (settled) return;
      settled = true;
      detach();
      fn(value);
    };
    const done = settle(resolve);
    const fail = settle(reject);

    const onMessage = (event) => {
      const msg = event?.data ?? event;
      if (!msg || typeof msg !== "object") return;
      switch (msg.type) {
        case "phase":
          try {
            onPhase?.(msg.phase);
          } catch (_e) {
            // A page callback must not break the derivation.
          }
          break;
        case "progress":
          try {
            onProgress?.(msg);
          } catch (_e) {
            // Non-fatal.
          }
          break;
        case "done":
          done(msg.result);
          break;
        case "error":
          fail(new Error(msg.message || "Subgraph derivation failed"));
          break;
      }
    };

    const onWorkerError = (event) => {
      fail(new Error(event?.message || "Subgraph worker crashed"));
    };

    if (worker.addEventListener) {
      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onWorkerError);
      worker.addEventListener("messageerror", onWorkerError);
    } else {
      worker.onmessage = onMessage;
      worker.onerror = onWorkerError;
      worker.onmessageerror = onWorkerError;
    }

    try {
      worker.postMessage(request);
    } catch (e) {
      fail(e instanceof Error ? e : new Error(String(e)));
    }
  });
}
