import { assert, assertEquals } from "./test_helpers.ts";

import {
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
