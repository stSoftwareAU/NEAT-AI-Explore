/**
 * Shared UI helper utilities (Issue #125).
 *
 * Pure, DOM-free functions extracted from app.js and graph/graph.js to
 * eliminate duplication and enable unit testing.
 *
 * This module is DOM-free and testable under Deno.
 */

/**
 * Escape a string for safe insertion into HTML.
 *
 * Replaces the five characters that have special meaning in HTML
 * (&, <, >, ", ') with their corresponding character references.
 *
 * @param {unknown} s — value to escape (coerced to string).
 * @returns {string}
 */
export function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Extract tooltip labels, descriptions, and groups from a snapshot.
 *
 * Returns plain objects (no global mutation) so callers can store the
 * results however they like.
 *
 * @param {object|null|undefined} snapshot
 * @returns {{ labels: Record<string, string>, descriptions: Record<string, string>, groups: Record<string, string> }}
 */
export function extractTooltips(snapshot) {
  /** @type {Record<string, string>} */
  const labels = {};
  /** @type {Record<string, string>} */
  const descriptions = {};
  /** @type {Record<string, string>} */
  const groups = {};

  const tooltipsByUuid = snapshot?.tooltips ?? snapshot?.meta?.tooltips ?? null;
  if (!tooltipsByUuid || typeof tooltipsByUuid !== "object") {
    return { labels, descriptions, groups };
  }

  for (const [uuid, info] of Object.entries(tooltipsByUuid)) {
    if (!uuid || typeof uuid !== "string") continue;
    if (!info || typeof info !== "object") continue;

    const label = info.label;
    const description = info.description;
    const group = info.group ?? info.category ?? info.domain ?? null;

    if (typeof label === "string" && label.trim().length > 0) {
      labels[uuid] = label.trim();
    }
    if (typeof description === "string" && description.trim().length > 0) {
      descriptions[uuid] = description.trim();
    }
    if (typeof group === "string" && group.trim().length > 0) {
      groups[uuid] = group.trim();
    }
  }

  return { labels, descriptions, groups };
}
