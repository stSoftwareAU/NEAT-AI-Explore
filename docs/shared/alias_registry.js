/**
 * Shared alias registry for neuron labels/descriptions (Issue #125).
 *
 * Extracts tooltip data (labels, descriptions, groups) from a snapshot into
 * an immutable registry object. Previously duplicated as
 * loadInputLabelsFromSnapshot (app.js) and loadLabelsFromSnapshot (graph.js).
 *
 * This module is DOM-free and testable under Deno.
 */

/**
 * @typedef {object} AliasRegistry
 * @property {Record<string, string>} labels — UUID → human-friendly label.
 * @property {Record<string, string>} descriptions — UUID → description text.
 * @property {Record<string, string>} groups — UUID → group/category name.
 */

/**
 * Build an alias registry from snapshot tooltip data.
 *
 * @param {unknown} snapshot
 * @returns {AliasRegistry}
 */
export function buildAliasRegistry(snapshot) {
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

/**
 * Look up the human-friendly label for a UUID.
 *
 * @param {AliasRegistry} registry
 * @param {string} uuid
 * @returns {string|null}
 */
export function getAlias(registry, uuid) {
  return registry.labels[uuid] ?? null;
}

/**
 * Look up the description for a UUID.
 *
 * @param {AliasRegistry} registry
 * @param {string} uuid
 * @returns {string|null}
 */
export function getDescription(registry, uuid) {
  return registry.descriptions[uuid] ?? null;
}

/**
 * Look up the group/category for a UUID.
 *
 * @param {AliasRegistry} registry
 * @param {string} uuid
 * @returns {string|null}
 */
export function getGroup(registry, uuid) {
  return registry.groups[uuid] ?? null;
}
