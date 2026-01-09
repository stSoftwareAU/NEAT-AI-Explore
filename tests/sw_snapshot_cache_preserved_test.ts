/**
 * Tests that the snapshot cache is preserved across Service Worker version updates.
 *
 * Issue #52: First fetch fails after an application version change.
 *
 * Root cause: The app caches snapshots to a fixed "neat-ai-explore-snapshots"
 * cache, but the SW's activate handler deletes any cache that doesn't match
 * the versioned STATIC_CACHE or RUNTIME_CACHE names. This means the snapshot
 * cache gets deleted on SW updates, causing first-fetch failures.
 *
 * Fix: The SW should preserve the snapshot cache across version updates by
 * explicitly allowing it in the cleanup logic.
 *
 * Created: 10-Jan-2026
 */

function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  const root = here.replace(
    /\/tests\/sw_snapshot_cache_preserved_test\.ts$/,
    "",
  );
  return [root, ...parts].join("/");
}

const SNAPSHOT_CACHE_NAME = "neat-ai-explore-snapshots";

Deno.test("app.js and sw.js use consistent snapshot cache name (Issue #52)", async () => {
  const appPath = repoPath("docs", "app.js");
  const swPath = repoPath("docs", "sw.js");
  const appJs = await Deno.readTextFile(appPath);
  const swJs = await Deno.readTextFile(swPath);

  // The app must use a fixed snapshot cache name for caching fetched snapshots.
  assert(
    appJs.includes(`"${SNAPSHOT_CACHE_NAME}"`),
    `Expected app.js to use snapshot cache name "${SNAPSHOT_CACHE_NAME}"`,
  );

  // The SW must know about this cache name to preserve it on updates.
  assert(
    swJs.includes(SNAPSHOT_CACHE_NAME),
    `Expected sw.js to reference snapshot cache name "${SNAPSHOT_CACHE_NAME}" to preserve it across updates`,
  );
});

Deno.test("sw.js preserves snapshot cache during version updates (Issue #52)", async () => {
  const swPath = repoPath("docs", "sw.js");
  const swJs = await Deno.readTextFile(swPath);

  // The SW's activate handler should NOT delete the snapshot cache.
  // Look for the cache cleanup logic in the activate handler.
  const activateMatch = swJs.match(
    /self\.addEventListener\s*\(\s*["']activate["'][\s\S]*?\)\s*\)/,
  );

  assert(
    activateMatch,
    "Expected sw.js to have an activate event listener",
  );

  const activateHandler = activateMatch[0];

  // The cleanup logic should preserve caches that match:
  // - STATIC_CACHE (versioned)
  // - RUNTIME_CACHE (versioned)
  // - SNAPSHOT_CACHE_NAME (unversioned, survives updates)
  //
  // Pattern should be something like:
  //   if (key !== STATIC_CACHE && key !== RUNTIME_CACHE && key !== "neat-ai-explore-snapshots")
  // or
  //   const isPreserved = key === STATIC_CACHE || key === RUNTIME_CACHE || key === SNAPSHOT_CACHE;

  const preservesSnapshotCache =
    activateHandler.includes(SNAPSHOT_CACHE_NAME) ||
    swJs.includes(`SNAPSHOT_CACHE = "${SNAPSHOT_CACHE_NAME}"`);

  assert(
    preservesSnapshotCache,
    `SW activate handler must preserve the snapshot cache "${SNAPSHOT_CACHE_NAME}" ` +
      `to prevent first-fetch failures after version updates. Currently it only ` +
      `preserves versioned caches (STATIC_CACHE, RUNTIME_CACHE) and deletes everything else.`,
  );
});

Deno.test("sw.js defines SNAPSHOT_CACHE constant for clarity (Issue #52)", async () => {
  const swPath = repoPath("docs", "sw.js");
  const swJs = await Deno.readTextFile(swPath);

  // Best practice: define a constant for the snapshot cache name at the top
  // of sw.js (near STATIC_CACHE and RUNTIME_CACHE) for clarity and consistency.
  const hasSnapshotCacheConst = swJs.includes("SNAPSHOT_CACHE") &&
    swJs.includes(SNAPSHOT_CACHE_NAME);

  assert(
    hasSnapshotCacheConst,
    `Expected sw.js to define a SNAPSHOT_CACHE constant for the unversioned ` +
      `snapshot cache "${SNAPSHOT_CACHE_NAME}". This makes the cache naming ` +
      `strategy explicit and prevents accidental deletion.`,
  );
});

Deno.test("sw.js networkFirst uses unversioned SNAPSHOT_CACHE for JSON caching (Issue #52)", async () => {
  const swPath = repoPath("docs", "sw.js");
  const swJs = await Deno.readTextFile(swPath);

  // The networkFirst function should use SNAPSHOT_CACHE (unversioned) for
  // caching JSON responses, not RUNTIME_CACHE (versioned). This ensures
  // cached snapshots survive SW version updates.
  const networkFirstMatch = swJs.match(
    /async\s+function\s+networkFirst[\s\S]*?^}/m,
  );

  assert(
    networkFirstMatch,
    "Expected sw.js to have a networkFirst function",
  );

  const networkFirstBody = networkFirstMatch[0];

  // The function should open SNAPSHOT_CACHE, not RUNTIME_CACHE.
  const usesSnapshotCache = networkFirstBody.includes(
    "caches.open(SNAPSHOT_CACHE)",
  );

  assert(
    usesSnapshotCache,
    `The networkFirst function should use SNAPSHOT_CACHE for caching JSON ` +
      `snapshots, not RUNTIME_CACHE. Using the unversioned cache ensures ` +
      `snapshots survive SW version updates.`,
  );
});
