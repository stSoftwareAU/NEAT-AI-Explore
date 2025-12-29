/**
 * Tests that same-origin URLs with "Failed to fetch" errors attempt cache
 * fallback instead of throwing a CORS error.
 *
 * Issue: The fetchJson function throws a CORS error for all "Failed to fetch"
 * exceptions before the cache fallback logic can execute. However, on Chrome,
 * offline/network errors also produce "Failed to fetch", and same-origin
 * requests cannot have CORS issues.
 *
 * Created: 28-Dec-2025
 */

function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  // .../tests/same_origin_offline_fallback_test.ts -> repo root
  const root = here.replace(
    /\/tests\/same_origin_offline_fallback_test\.ts$/,
    "",
  );
  return [root, ...parts].join("/");
}

Deno.test("fetchJson should not throw CORS error for same-origin 'Failed to fetch' - allows cache fallback (28-Dec-2025)", async () => {
  const appPath = repoPath("docs", "app.js");
  const js = await Deno.readTextFile(appPath);

  // The catch block should check if the URL is same-origin before throwing a
  // CORS error. Same-origin URLs cannot have CORS issues, so "Failed to fetch"
  // for same-origin URLs is more likely an offline/network error.
  //
  // The fix should gate the CORS error throw on cross-origin status, e.g.:
  //   if (e?.message === "Failed to fetch" && !isSameOriginUrl(u)) { throw CORS error }
  //
  // Or equivalently:
  //   if (e?.message === "Failed to fetch" && !canUseCacheFallback) { throw CORS error }
  //
  // This allows the cache fallback logic to execute for same-origin URLs.

  // Extract the catch block from fetchJson to analyse its logic.
  const fetchJsonMatch = js.match(
    /async\s+function\s+fetchJson\s*\([^)]*\)\s*\{[\s\S]*?^\}/m,
  );
  assert(fetchJsonMatch, "Expected to find fetchJson function in app.js");

  const fetchJsonBody = fetchJsonMatch[0];

  // Look for the pattern where "Failed to fetch" check includes a same-origin gate.
  // Valid patterns include:
  //   - if (e?.message === "Failed to fetch" && !isSameOriginUrl(u))
  //   - if (e?.message === "Failed to fetch" && !canUseCacheFallback)
  //   - if (!isSameOriginUrl(u) && e?.message === "Failed to fetch")
  //   - if (!canUseCacheFallback && e?.message === "Failed to fetch")
  const hasSameOriginGate =
    // Pattern: check for cross-origin before CORS throw
    /Failed to fetch.*&&.*(!isSameOriginUrl|!canUseCacheFallback)/.test(
      fetchJsonBody,
    ) ||
    /(!isSameOriginUrl|!canUseCacheFallback).*&&.*Failed to fetch/.test(
      fetchJsonBody,
    );

  assert(
    hasSameOriginGate,
    "fetchJson should only throw CORS error for cross-origin URLs. " +
      "Same-origin URLs with 'Failed to fetch' (e.g., offline) should proceed " +
      "to cache fallback logic instead of immediately throwing a CORS error.",
  );
});

Deno.test("fetchJson catches 'Failed to fetch' and attempts cache fallback for same-origin (28-Dec-2025)", async () => {
  const appPath = repoPath("docs", "app.js");
  const js = await Deno.readTextFile(appPath);

  // The cache fallback should be reachable for same-origin URLs when
  // "Failed to fetch" occurs. Verify that the catch block structure allows this.

  // Check that the CORS throw and cache fallback are in a structure that allows
  // cache fallback to run when same-origin.
  const catchBlockMatch = js.match(
    /catch\s*\(\s*e\s*\)\s*\{[\s\S]*?(?=^\s*\/\/\s*If the network returned|^\s*if\s*\(\s*res\s*&&\s*!res\.ok)/m,
  );

  assert(catchBlockMatch, "Expected to find catch block in fetchJson");

  const catchBlock = catchBlockMatch[0];

  // The catch block should:
  // 1. Only throw CORS error for cross-origin (not same-origin)
  // 2. Allow cache fallback to proceed for same-origin

  // Verify that canUseCacheFallback or isSameOriginUrl is used to gate the CORS throw.
  const corsThrowIsGated = catchBlock.includes("!isSameOriginUrl") ||
    catchBlock.includes("!canUseCacheFallback");

  assert(
    corsThrowIsGated,
    "CORS error throw should be gated by same-origin check. " +
      "Without this, same-origin offline errors will never reach cache fallback.",
  );
});
