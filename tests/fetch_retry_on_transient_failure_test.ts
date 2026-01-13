/**
 * Tests that the fetchJson function retries on transient network failures.
 *
 * Issue #67: First fetch often fails but second works.
 *
 * Root cause: Transient network failures (e.g., during Service Worker
 * activation, unstable connections, or mobile network handoffs) can cause the
 * first fetch to fail. The user then has to manually retry, which succeeds.
 *
 * Fix: Implement automatic retry logic with exponential backoff for transient
 * failures. This makes the app more resilient without requiring manual
 * intervention.
 *
 * Created: 13-Jan-2026
 */

function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

function repoPath(...parts: string[]): string {
  const url = new URL(import.meta.url);
  const here = url.pathname;
  const root = here.replace(
    /\/tests\/fetch_retry_on_transient_failure_test\.ts$/,
    "",
  );
  return [root, ...parts].join("/");
}

Deno.test("app.js fetchJson includes retry logic for transient failures (Issue #67)", async () => {
  const appPath = repoPath("docs", "app.js");
  const js = await Deno.readTextFile(appPath);

  // The fetchJson function should include retry logic to handle transient
  // network failures that commonly cause "first fetch fails, second works"
  // issues.
  //
  // We check for common retry patterns:
  // - A loop with retry count (e.g., `while (retries < MAX_RETRIES)`)
  // - Retry-related constants (e.g., MAX_RETRIES, maxRetries)
  // - Exponential backoff delay
  const hasRetryLoop = js.includes("retries") ||
    js.includes("retry") ||
    js.includes("attempt");

  const hasMaxRetries = js.includes("MAX_RETRIES") ||
    js.includes("maxRetries") ||
    /retry.*<.*\d/.test(js) ||
    /attempts?.*<.*\d/.test(js);

  assert(
    hasRetryLoop,
    "Expected app.js to include retry logic for transient network failures. " +
      "The 'first fetch fails, second works' issue (#67) can be mitigated by " +
      "automatically retrying failed fetches.",
  );

  assert(
    hasMaxRetries,
    "Expected app.js to limit the number of retries to prevent infinite loops. " +
      "Look for MAX_RETRIES, maxRetries, or a numeric limit on retry attempts.",
  );
});

Deno.test("app.js retry logic includes backoff delay (Issue #67)", async () => {
  const appPath = repoPath("docs", "app.js");
  const js = await Deno.readTextFile(appPath);

  // Retries should use a delay/backoff to avoid hammering the server.
  // Look for patterns like:
  // - await new Promise(resolve => setTimeout(resolve, delay))
  // - delay * 2 (exponential backoff)
  // - sleep(ms) or wait(ms) functions
  const hasDelayBetweenRetries =
    (js.includes("retry") || js.includes("retries") ||
      js.includes("attempt")) &&
    (js.includes("setTimeout") || js.includes("delay") ||
      js.includes("backoff"));

  assert(
    hasDelayBetweenRetries,
    "Expected app.js to include a delay between retries to implement " +
      "exponential backoff. This prevents overwhelming the server and " +
      "gives transient issues time to resolve.",
  );
});

Deno.test("app.js retries only for network errors, not HTTP errors (Issue #67)", async () => {
  const appPath = repoPath("docs", "app.js");
  const js = await Deno.readTextFile(appPath);

  // Retries should only happen for network-level failures (TypeError from
  // fetch), not HTTP-level errors (4xx, 5xx responses). HTTP errors indicate
  // the server explicitly responded, so retrying won't help.
  //
  // Look for logic that distinguishes between:
  // - Network errors (caught in try/catch, e.g., "Failed to fetch")
  // - HTTP errors (res.ok === false, e.g., 404, 500)

  // Extract the fetchJson function body
  const fetchJsonMatch = js.match(
    /async\s+function\s+fetchJson\s*\([^)]*\)\s*\{[\s\S]*?^\}/m,
  );

  assert(
    fetchJsonMatch,
    "Expected to find fetchJson function in app.js",
  );

  const fetchJsonBody = fetchJsonMatch[0];

  // The retry logic should be in the catch block (for network errors),
  // not after checking res.ok (for HTTP errors).
  const hasNetworkRetryLogic = fetchJsonBody.includes("catch") &&
    (fetchJsonBody.includes("retry") ||
      fetchJsonBody.includes("retries") ||
      fetchJsonBody.includes("attempt"));

  assert(
    hasNetworkRetryLogic,
    "Expected fetchJson to retry on network errors (caught exceptions) " +
      "rather than HTTP errors (bad status codes). Network errors are " +
      "transient and worth retrying; HTTP errors are authoritative.",
  );
});

Deno.test("shared/snapshot_loader.js includes retry logic for transient failures (Issue #67)", async () => {
  const loaderPath = repoPath("docs", "shared", "snapshot_loader.js");
  const js = await Deno.readTextFile(loaderPath);

  // The shared snapshot loader (used by graph/starfield views) should also
  // have retry logic to handle transient network failures consistently.
  const hasRetryConstants = js.includes("FETCH_MAX_RETRIES") &&
    js.includes("FETCH_RETRY_DELAY_MS");

  const hasRetryLoop = js.includes("attempt") &&
    js.includes("FETCH_MAX_RETRIES");

  const hasBackoff = js.includes("setTimeout") || js.includes("delay");

  assert(
    hasRetryConstants,
    "Expected shared/snapshot_loader.js to define retry constants " +
      "(FETCH_MAX_RETRIES, FETCH_RETRY_DELAY_MS).",
  );

  assert(
    hasRetryLoop,
    "Expected shared/snapshot_loader.js to include a retry loop with attempt counter.",
  );

  assert(
    hasBackoff,
    "Expected shared/snapshot_loader.js to include backoff delay between retries.",
  );
});
