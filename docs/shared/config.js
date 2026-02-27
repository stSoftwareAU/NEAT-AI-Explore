/**
 * Shared snapshot configuration (Issue #93).
 *
 * Single source of truth for the default snapshot URL and fallback URLs.
 * Imported by both the trace explorer (app.js) and the graph explorer
 * (graph/graph.js) to ensure consistent behaviour.
 *
 * This module is DOM-free and testable under Deno.
 */

/**
 * Default snapshot used when the app is opened without a URL parameter.
 *
 * Hosted in a dedicated repo (`NEAT-AI-Snapshot`) published via GitHub Pages.
 * This keeps the Explore repo program-only and avoids churn from committing
 * large binary snapshot artefacts.
 *
 * Note: avoid a leading "./" because some static hosts treat "/./file" as a
 * distinct path (and may 404) rather than normalising it.
 */
export const DEFAULT_SNAPSHOT_URL =
  "https://stsoftwareau.github.io/NEAT-AI-Snapshot/snapshot.json.gz";

/**
 * Fallbacks used when GitHub Pages is blocked by CORS on some networks.
 * `raw.githubusercontent.com` typically ships permissive CORS headers.
 */
export const SNAPSHOT_FALLBACK_URLS = [
  "https://raw.githubusercontent.com/stSoftwareAU/NEAT-AI-Snapshot/Develop/docs/snapshot.json.gz",
  "https://raw.githubusercontent.com/stSoftwareAU/NEAT-AI-Snapshot/main/docs/snapshot.json.gz",
  "snapshot.json.gz", // last resort: same-origin (if present)
];

/**
 * Origins allowed for snapshot caching (Issue #125).
 *
 * The canonical list of cross-origin hosts from which snapshots may be cached
 * for offline use. Same-origin is always allowed implicitly; these are the
 * additional trusted origins.
 *
 * Note: the Service Worker (sw.js) cannot use ES module imports, so it keeps
 * its own copy with a comment pointing here as the single source of truth.
 */
export const ALLOWED_SNAPSHOT_ORIGINS = [
  "https://stsoftwareau.github.io",
  "https://raw.githubusercontent.com",
];

/**
 * Maximum number of top-level auto-load retries when the initial page load
 * fails to fetch a snapshot (Issue #118). This is separate from the per-fetch
 * retry loop in snapshot_loader.js — it retries the entire load sequence
 * (including fallback URLs) after a longer delay, giving the Service Worker
 * and network more time to settle.
 */
export const AUTO_LOAD_MAX_RETRIES = 2;

/**
 * Initial delay (ms) before the first auto-load retry. Doubles on each
 * subsequent attempt (exponential backoff). Longer than the per-fetch delay
 * because this covers transient issues like Service Worker activation that
 * need more time to resolve.
 */
export const AUTO_LOAD_RETRY_DELAY_MS = 2000;
