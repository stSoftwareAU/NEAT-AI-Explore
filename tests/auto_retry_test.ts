import { assert, assertEquals } from "./test_helpers.ts";

import {
  LOAD_AUTO_RETRY_DELAY_MS,
  LOAD_AUTO_RETRY_LIMIT,
} from "../docs/shared/config.js";

import { computeRetryDelayMs } from "../docs/shared/snapshot_loader.js";

// --- LOAD_AUTO_RETRY_LIMIT ---

Deno.test("LOAD_AUTO_RETRY_LIMIT is a positive integer", () => {
  assertEquals(typeof LOAD_AUTO_RETRY_LIMIT, "number");
  assert(LOAD_AUTO_RETRY_LIMIT >= 1, "Expected at least 1 auto-retry");
  assertEquals(
    LOAD_AUTO_RETRY_LIMIT,
    Math.floor(LOAD_AUTO_RETRY_LIMIT),
    "Expected an integer",
  );
});

Deno.test("LOAD_AUTO_RETRY_LIMIT is at most 5", () => {
  assert(
    LOAD_AUTO_RETRY_LIMIT <= 5,
    "More than 5 auto-retries would delay user feedback too long",
  );
});

// --- LOAD_AUTO_RETRY_DELAY_MS ---

Deno.test("LOAD_AUTO_RETRY_DELAY_MS is a positive number", () => {
  assertEquals(typeof LOAD_AUTO_RETRY_DELAY_MS, "number");
  assert(
    LOAD_AUTO_RETRY_DELAY_MS >= 1000,
    "Auto-retry delay should be at least 1 second",
  );
});

Deno.test("LOAD_AUTO_RETRY_DELAY_MS is at most 10 seconds", () => {
  assert(
    LOAD_AUTO_RETRY_DELAY_MS <= 10000,
    "Auto-retry delay should not exceed 10 seconds",
  );
});

// --- computeRetryDelayMs ---

Deno.test("computeRetryDelayMs returns baseDelay for attempt 0", () => {
  assertEquals(computeRetryDelayMs(0, 1000), 1000);
});

Deno.test("computeRetryDelayMs doubles on each attempt (exponential backoff)", () => {
  assertEquals(computeRetryDelayMs(0, 500), 500);
  assertEquals(computeRetryDelayMs(1, 500), 1000);
  assertEquals(computeRetryDelayMs(2, 500), 2000);
  assertEquals(computeRetryDelayMs(3, 500), 4000);
});

Deno.test("computeRetryDelayMs caps at 30 seconds", () => {
  // Very high attempt number should not produce an absurdly long delay.
  const delay = computeRetryDelayMs(20, 1000);
  assert(delay <= 30000, `Expected delay <= 30000 but got ${delay}`);
});

Deno.test("computeRetryDelayMs handles zero base delay", () => {
  assertEquals(computeRetryDelayMs(0, 0), 0);
  assertEquals(computeRetryDelayMs(5, 0), 0);
});
