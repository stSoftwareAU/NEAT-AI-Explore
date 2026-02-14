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
