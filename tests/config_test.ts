import { assert, assertEquals } from "./test_helpers.ts";

import {
  ALLOWED_SNAPSHOT_ORIGINS,
  AUTO_LOAD_MAX_RETRIES,
  AUTO_LOAD_RETRY_DELAY_MS,
  DEFAULT_SNAPSHOT_URL,
  SNAPSHOT_FALLBACK_URLS,
} from "../docs/shared/config.js";

// --- DEFAULT_SNAPSHOT_URL ---

Deno.test("DEFAULT_SNAPSHOT_URL is a valid HTTPS URL", () => {
  assert(
    DEFAULT_SNAPSHOT_URL.startsWith("https://"),
    "Expected DEFAULT_SNAPSHOT_URL to start with https://",
  );
});

Deno.test("DEFAULT_SNAPSHOT_URL points to the snapshot repo", () => {
  assert(
    DEFAULT_SNAPSHOT_URL.includes("NEAT-AI-Snapshot"),
    "Expected DEFAULT_SNAPSHOT_URL to reference the NEAT-AI-Snapshot repo",
  );
});

Deno.test("DEFAULT_SNAPSHOT_URL ends with snapshot.json.gz", () => {
  assert(
    DEFAULT_SNAPSHOT_URL.endsWith("snapshot.json.gz"),
    "Expected DEFAULT_SNAPSHOT_URL to end with snapshot.json.gz",
  );
});

// --- SNAPSHOT_FALLBACK_URLS ---

Deno.test("SNAPSHOT_FALLBACK_URLS is a non-empty array", () => {
  assert(Array.isArray(SNAPSHOT_FALLBACK_URLS), "Expected an array");
  assert(SNAPSHOT_FALLBACK_URLS.length > 0, "Expected at least one fallback");
});

Deno.test("SNAPSHOT_FALLBACK_URLS does not include DEFAULT_SNAPSHOT_URL", () => {
  assertEquals(
    SNAPSHOT_FALLBACK_URLS.includes(DEFAULT_SNAPSHOT_URL),
    false,
    "Fallback list should not include the default URL (it would be redundant)",
  );
});

Deno.test("SNAPSHOT_FALLBACK_URLS entries are all strings", () => {
  for (const url of SNAPSHOT_FALLBACK_URLS) {
    assertEquals(typeof url, "string", "Each fallback URL must be a string");
    assert(url.length > 0, "Fallback URLs must not be empty strings");
  }
});

Deno.test("SNAPSHOT_FALLBACK_URLS includes a raw.githubusercontent.com entry", () => {
  const hasRawGh = SNAPSHOT_FALLBACK_URLS.some((u: string) =>
    u.includes("raw.githubusercontent.com")
  );
  assert(
    hasRawGh,
    "Expected at least one fallback using raw.githubusercontent.com",
  );
});

Deno.test("SNAPSHOT_FALLBACK_URLS includes a same-origin fallback", () => {
  const hasSameOrigin = SNAPSHOT_FALLBACK_URLS.some((u: string) =>
    !u.startsWith("http")
  );
  assert(
    hasSameOrigin,
    "Expected at least one same-origin (relative path) fallback",
  );
});

// --- ALLOWED_SNAPSHOT_ORIGINS (Issue #125) ---

Deno.test("ALLOWED_SNAPSHOT_ORIGINS is a non-empty array", () => {
  assert(Array.isArray(ALLOWED_SNAPSHOT_ORIGINS), "Expected an array");
  assert(
    ALLOWED_SNAPSHOT_ORIGINS.length > 0,
    "Expected at least one allowed origin",
  );
});

Deno.test("ALLOWED_SNAPSHOT_ORIGINS includes GitHub Pages origin", () => {
  assert(
    ALLOWED_SNAPSHOT_ORIGINS.includes("https://stsoftwareau.github.io"),
    "Expected GitHub Pages origin",
  );
});

Deno.test("ALLOWED_SNAPSHOT_ORIGINS includes raw.githubusercontent.com", () => {
  assert(
    ALLOWED_SNAPSHOT_ORIGINS.includes("https://raw.githubusercontent.com"),
    "Expected raw.githubusercontent.com origin",
  );
});

Deno.test("ALLOWED_SNAPSHOT_ORIGINS entries are valid HTTPS origins", () => {
  for (const origin of ALLOWED_SNAPSHOT_ORIGINS) {
    assert(
      origin.startsWith("https://"),
      `Expected HTTPS origin, got: ${origin}`,
    );
    assertEquals(
      origin.endsWith("/"),
      false,
      `Origins should not have a trailing slash: ${origin}`,
    );
  }
});

// --- AUTO_LOAD_MAX_RETRIES (Issue #118) ---

Deno.test("AUTO_LOAD_MAX_RETRIES is a positive integer", () => {
  assertEquals(typeof AUTO_LOAD_MAX_RETRIES, "number");
  assert(AUTO_LOAD_MAX_RETRIES >= 1, "Expected at least 1 retry");
  assertEquals(
    AUTO_LOAD_MAX_RETRIES,
    Math.floor(AUTO_LOAD_MAX_RETRIES),
    "Expected an integer",
  );
});

// --- AUTO_LOAD_RETRY_DELAY_MS (Issue #118) ---

Deno.test("AUTO_LOAD_RETRY_DELAY_MS is a positive number", () => {
  assertEquals(typeof AUTO_LOAD_RETRY_DELAY_MS, "number");
  assert(
    AUTO_LOAD_RETRY_DELAY_MS >= 500,
    "Expected delay of at least 500ms to allow Service Worker to settle",
  );
});
