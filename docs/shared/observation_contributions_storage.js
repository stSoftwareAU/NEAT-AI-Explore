/**
 * Persistence helpers for the Observation contributions panel top-N stepper
 * (Issue #243).
 *
 * Pure, DOM-free wrappers around `localStorage` so the panel-scoped value
 * survives reloads. Both read and write are defensive: in privacy modes,
 * full storage, or sandboxed contexts `localStorage` access can throw, and
 * the panel must still render and respond to user input.
 *
 * The storage interface is injected (`storage` parameter) so the helpers can
 * be unit-tested without a real `localStorage`.
 */

import { clampTopN, DEFAULT_TOP_N } from "./observation_contributions.js";

/** Panel-scoped localStorage key. */
export const OBSERVATION_TOP_N_KEY = "obs-contrib.topN";

/**
 * @typedef {object} StorageLike
 * @property {(key: string) => (string | null)} getItem
 * @property {(key: string, value: string) => void} setItem
 */

/**
 * Read the persisted top-N from storage, clamping and falling back to the
 * default on any failure (missing, corrupt, or storage unavailable).
 *
 * @param {StorageLike | null | undefined} [storage] — defaults to
 *   `globalThis.localStorage` when omitted.
 * @returns {number} integer in [1, MAX_TOP_N]
 */
export function loadObservationTopN(storage) {
  const store = resolveStorage(storage);
  if (!store) return DEFAULT_TOP_N;
  try {
    const raw = store.getItem(OBSERVATION_TOP_N_KEY);
    if (raw == null) return DEFAULT_TOP_N;
    return clampTopN(raw);
  } catch (_e) {
    return DEFAULT_TOP_N;
  }
}

/**
 * Persist the top-N value. Silently swallows storage errors (private mode,
 * quota exceeded) so the UI stays responsive.
 *
 * @param {number} value
 * @param {StorageLike | null | undefined} [storage]
 * @returns {boolean} true when the write succeeded
 */
export function saveObservationTopN(value, storage) {
  const store = resolveStorage(storage);
  if (!store) return false;
  try {
    store.setItem(OBSERVATION_TOP_N_KEY, String(clampTopN(value)));
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
