/**
 * Observation family grouping (Issue #524).
 *
 * The default published snapshot carries 2,461 input observations. Rendering
 * one node per observation is unreadable, so the aggregated layered graph
 * model buckets them into a handful of **families** first.
 *
 * A family key is derived from the observation metadata the viewer already
 * has — the snapshot's `tooltips` entries surfaced by `extractTooltips`:
 *
 *   1. the tooltip `group` (GRQ supplies e.g. `macro`, `rates`, `equities`);
 *   2. failing that, the leading segment of the observation label, split on
 *      the first `:`, `/`, `|` or spaced dash;
 *   3. failing that, {@link UNGROUPED_FAMILY_KEY}.
 *
 * Callers that need a different bucketing — a per-stock view, for instance —
 * pass their own `deriveFamily`. Every family retains its member UUIDs, so a
 * later per-stock or stock-comparison view can re-expand or re-weight a
 * family without rebuilding the model.
 *
 * Intentionally DOM-free so it can be unit-tested under Deno.
 */

/** Family key used when no group or label metadata is available. */
export const UNGROUPED_FAMILY_KEY = "ungrouped";

/** Separators that terminate the leading segment of an observation label. */
const LABEL_SEPARATOR_RE = /\s+[—–-]\s+|[:/|]/;

/**
 * Slugify a display label into a stable, comparable family key.
 *
 * Lower-cased, with every run of non-alphanumeric characters folded to a
 * single hyphen and leading/trailing hyphens removed.
 *
 * @param {unknown} text
 * @returns {string} the key, or `""` when nothing usable remains.
 */
export function normaliseFamilyKey(text) {
  if (typeof text !== "string") return "";
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Derive the family key and display label for a single observation.
 *
 * @param {{ uuid?: string, label?: string|null, group?: string|null }} observation
 * @returns {{ key: string, label: string }}
 */
export function deriveObservationFamily(observation) {
  const { label = null, group = null } = observation ?? {};

  const groupText = typeof group === "string" ? group.trim() : "";
  if (groupText) {
    const key = normaliseFamilyKey(groupText);
    if (key) return { key, label: groupText };
  }

  const labelText = typeof label === "string" ? label.trim() : "";
  if (labelText) {
    const head = labelText.split(LABEL_SEPARATOR_RE)[0].trim();
    const key = normaliseFamilyKey(head);
    if (key) return { key, label: head };
  }

  return { key: UNGROUPED_FAMILY_KEY, label: UNGROUPED_FAMILY_KEY };
}

/**
 * @typedef {object} ObservationFamily
 * @property {string} key — stable slug used as the aggregate node identity.
 * @property {string} label — human-readable family name.
 * @property {string[]} members — member observation UUIDs, in caller order.
 * @property {number} memberCount
 */

/**
 * Bucket observations into families.
 *
 * Output is deterministic: families are sorted by key, and each family's
 * members keep the caller's ordering.
 *
 * @param {{
 *   uuids: unknown[],
 *   labels?: Record<string, string>,
 *   groups?: Record<string, string>,
 *   deriveFamily?: ((observation: { uuid: string, label: string|null, group: string|null }) => { key: string, label?: string }) | null,
 * }} input
 * @returns {ObservationFamily[]}
 */
export function groupObservationsByFamily(input) {
  const {
    uuids = [],
    labels = {},
    groups = {},
    deriveFamily = null,
  } = input ?? {};

  const derive = typeof deriveFamily === "function"
    ? deriveFamily
    : deriveObservationFamily;

  /** @type {Map<string, ObservationFamily>} */
  const byKey = new Map();

  for (const raw of (Array.isArray(uuids) ? uuids : [])) {
    if (typeof raw !== "string" || raw.length === 0) continue;

    const observation = {
      uuid: raw,
      label: labels?.[raw] ?? null,
      group: groups?.[raw] ?? null,
    };
    const derived = derive(observation) ?? {};
    const key = normaliseFamilyKey(derived.key) || UNGROUPED_FAMILY_KEY;
    const label = typeof derived.label === "string" && derived.label.trim()
      ? derived.label.trim()
      : key;

    let family = byKey.get(key);
    if (!family) {
      family = { key, label, members: [], memberCount: 0 };
      byKey.set(key, family);
    }
    family.members.push(raw);
    family.memberCount = family.members.length;
  }

  return Array.from(byKey.values()).sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0
  );
}
