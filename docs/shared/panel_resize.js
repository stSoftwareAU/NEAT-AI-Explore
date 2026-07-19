/**
 * Pure, DOM-free helpers for resizable explorer panels (Issue #510).
 *
 * The explorer's main split (neuron detail ↔ inbound synapses) and the 3D
 * graph view's Focus/Legend overlays can be resized by dragging a divider or
 * edge handle. The chosen sizes are remembered per browser/device via
 * `localStorage` and restored on load, clamped to the current viewport bounds.
 *
 * This module holds only the maths and the persistence wrappers so the logic
 * can be unit-tested without a DOM. The drag wiring itself lives in `app.js`
 * (explorer) and `graph/graph.js` (overlays) — browser-only, so not unit
 * tested here.
 *
 * Both read and write are defensive: in privacy modes, full storage, or
 * sandboxed contexts `localStorage` access can throw, so callers keep working
 * with the in-memory default. The storage interface is injected (`storage`
 * parameter) so the helpers can be unit-tested without a real `localStorage`.
 *
 * Last updated: 19-Jul-2026
 */

/** localStorage keys — one per resizable boundary. */
export const PANEL_SIZE_KEYS = {
  explorerNeuron: "panelSize.explorerNeuron",
  graphHud: "panelSize.graphHud",
  graphLegend: "panelSize.graphLegend",
};

/**
 * Parse a raw stored value (string or number) into a finite, strictly
 * positive pixel size, or `null` when it is missing/corrupt. A size of zero
 * or a negative number is treated as corrupt — a panel can never be that
 * small — so the caller falls back to its default.
 *
 * @param {unknown} raw
 * @returns {number | null}
 */
export function parsePanelSize(raw) {
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  }
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Clamp a size to `[min, max]`. Returns `null` for a non-finite input so the
 * caller can fall back to a default. When `max < min` (viewport smaller than
 * the minimum usable width) fitting the viewport wins and `max` is returned —
 * this is the standard clamp semantics of `min(max(v, min), max)`.
 *
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number | null}
 */
export function clampPanelSize(value, min, max) {
  if (
    !Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)
  ) {
    return null;
  }
  return Math.min(Math.max(value, min), max);
}

/**
 * Resolve the size to apply on load. Prefers a valid stored value clamped to
 * the current `[min, max]` viewport bounds; otherwise falls back to the
 * (clamped) default. This is where "a saved size that no longer fits is
 * clamped rather than applied verbatim" is enforced.
 *
 * @param {object} opts
 * @param {unknown} opts.stored — raw value read from storage (or `null`)
 * @param {number} opts.fallback — default size when nothing valid is stored
 * @param {number} opts.min
 * @param {number} opts.max
 * @returns {number | null}
 */
export function resolveInitialPanelSize({ stored, fallback, min, max }) {
  const parsed = parsePanelSize(stored);
  if (parsed !== null) {
    const clamped = clampPanelSize(parsed, min, max);
    if (clamped !== null) return clamped;
  }
  return clampPanelSize(fallback, min, max);
}

/**
 * Compute the new size during a drag. `delta` is the signed pixel amount to
 * add to the panel's start size — the caller derives its sign from which edge
 * the handle sits on (grow-right → `pointer - start`; grow-left →
 * `start - pointer`). The result is clamped to `[min, max]`.
 *
 * @param {object} opts
 * @param {number} opts.startSize — panel size when the drag began
 * @param {number} opts.delta — signed pixels to add
 * @param {number} opts.min
 * @param {number} opts.max
 * @returns {number | null}
 */
export function computeDragPanelSize({ startSize, delta, min, max }) {
  if (!Number.isFinite(startSize) || !Number.isFinite(delta)) return null;
  return clampPanelSize(startSize + delta, min, max);
}

/**
 * @typedef {object} StorageLike
 * @property {(key: string) => (string | null)} getItem
 * @property {(key: string, value: string) => void} setItem
 * @property {(key: string) => void} removeItem
 */

/**
 * Read a persisted panel size, returning the parsed positive number or `null`
 * when missing/corrupt or storage is unavailable.
 *
 * @param {string} key
 * @param {StorageLike | null | undefined} [storage]
 * @returns {number | null}
 */
export function loadPanelSize(key, storage) {
  const store = resolveStorage(storage);
  if (!store) return null;
  try {
    return parsePanelSize(store.getItem(key));
  } catch (_e) {
    return null;
  }
}

/**
 * Persist a panel size. Silently swallows storage errors (private mode, quota)
 * so the UI stays responsive. Refuses to write a non-positive/non-finite size.
 *
 * @param {string} key
 * @param {number} value
 * @param {StorageLike | null | undefined} [storage]
 * @returns {boolean} true when the write succeeded
 */
export function savePanelSize(key, value, storage) {
  const store = resolveStorage(storage);
  if (!store) return false;
  const size = parsePanelSize(value);
  if (size === null) return false;
  try {
    store.setItem(key, String(size));
    return true;
  } catch (_e) {
    return false;
  }
}

/**
 * Forget a persisted panel size (used by the double-click/double-tap reset so
 * the boundary returns to its default on the next load).
 *
 * @param {string} key
 * @param {StorageLike | null | undefined} [storage]
 * @returns {boolean} true when the removal succeeded
 */
export function clearPanelSize(key, storage) {
  const store = resolveStorage(storage);
  if (!store) return false;
  try {
    store.removeItem(key);
    return true;
  } catch (_e) {
    return false;
  }
}

function resolveStorage(storage) {
  if (storage !== undefined) return storage ?? null;
  try {
    return globalThis.localStorage ?? null;
  } catch (_e) {
    return null;
  }
}
