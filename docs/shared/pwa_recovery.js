/**
 * PWA recovery helper (Issue #194).
 *
 * When the app shell loads from the Service Worker cache but the cached
 * `app.js` (or one of its dependencies) is stale and fails to import, we
 * used to tell the user to "clear your browser cache and reload". On an
 * installed PWA — especially on iOS — that is a dead end: there is no
 * obvious cache to clear without uninstalling the app.
 *
 * This module replaces that dead-end with an automatic self-heal:
 *
 *   1. Set a `sessionStorage` flag so we only attempt once per session.
 *   2. Delete every Cache Storage cache (static + runtime + snapshots).
 *   3. Unregister every Service Worker.
 *   4. Reload the page — the next load will fetch fresh assets and
 *      register a fresh Service Worker.
 *
 * The session flag prevents an infinite recovery loop if the underlying
 * failure is not actually caching-related (e.g. a genuine network outage
 * or a syntax error in the deployed JS).
 *
 * All side-effect surfaces (storage, caches, navigator.serviceWorker,
 * location.reload) are injected so the logic is testable under Deno.
 */

const RECOVERY_FLAG_KEY = "neatAiExplore_pwaRecoveryAttempt";

/**
 * @param {Storage | null | undefined} storage
 * @returns {boolean} true if a recovery attempt has not yet been made this session.
 */
export function shouldAttemptRecovery(storage) {
  if (!storage) return false;
  try {
    return storage.getItem(RECOVERY_FLAG_KEY) !== "1";
  } catch {
    return false;
  }
}

/**
 * @param {Storage | null | undefined} storage
 */
export function markRecoveryAttempted(storage) {
  if (!storage) return;
  try {
    storage.setItem(RECOVERY_FLAG_KEY, "1");
  } catch {
    // sessionStorage may be unavailable (private browsing, quota, etc.).
  }
}

/**
 * @param {Storage | null | undefined} storage
 */
export function clearRecoveryFlag(storage) {
  if (!storage) return;
  try {
    storage.removeItem(RECOVERY_FLAG_KEY);
  } catch {
    // Ignore.
  }
}

/**
 * Delete every Cache Storage cache.
 *
 * @param {CacheStorage | null | undefined} cachesApi
 * @returns {Promise<string[]>} the cache keys that were deleted.
 */
export async function clearAllCaches(cachesApi) {
  if (!cachesApi || typeof cachesApi.keys !== "function") return [];
  const keys = await cachesApi.keys();
  await Promise.all(keys.map((k) => cachesApi.delete(k)));
  return keys;
}

/**
 * Unregister every Service Worker registration.
 *
 * @param {ServiceWorkerContainer | null | undefined} swContainer
 * @returns {Promise<number>} the number of registrations unregistered.
 */
export async function unregisterAllServiceWorkers(swContainer) {
  if (!swContainer || typeof swContainer.getRegistrations !== "function") {
    return 0;
  }
  const regs = await swContainer.getRegistrations();
  await Promise.all(regs.map((r) => r.unregister()));
  return regs.length;
}

/**
 * Attempt to recover from a failed app-shell load.
 *
 * @param {object} deps
 * @param {Storage | null} deps.storage - sessionStorage (or compatible).
 * @param {CacheStorage | null} deps.cachesApi - window.caches (or compatible).
 * @param {ServiceWorkerContainer | null} deps.swContainer -
 *   navigator.serviceWorker (or compatible).
 * @param {() => void} deps.reload - called to trigger a page reload.
 * @returns {Promise<{recovered: boolean, reason: string}>}
 */
export async function recoverFromFailedAppLoad(deps) {
  const { storage, cachesApi, swContainer, reload } = deps ?? {};

  // Without storage we cannot detect repeated attempts, so refuse outright —
  // an infinite reload spiral is worse than a stuck error message.
  if (!storage) {
    return { recovered: false, reason: "no-storage" };
  }
  if (!shouldAttemptRecovery(storage)) {
    return { recovered: false, reason: "already-attempted" };
  }
  markRecoveryAttempted(storage);
  await clearAllCaches(cachesApi);
  await unregisterAllServiceWorkers(swContainer);
  if (typeof reload === "function") reload();
  return { recovered: true, reason: "cleared-and-reloaded" };
}
