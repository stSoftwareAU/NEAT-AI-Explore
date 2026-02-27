/**
 * Shared UI helper utilities (Issue #125).
 *
 * Pure, DOM-free functions extracted from app.js and graph.js to eliminate
 * duplication and enable unit testing under Deno.
 *
 * DOM-dependent helpers (setStatus, showProgress, updateProgress, hideProgress)
 * remain in their respective view files because they depend on page-specific
 * element references. Only escapeHtml — a pure string transform — lives here.
 */

/**
 * Escape a value for safe insertion into HTML.
 *
 * Handles the five characters that have special meaning in HTML:
 * `&`, `<`, `>`, `"`, `'`.
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
