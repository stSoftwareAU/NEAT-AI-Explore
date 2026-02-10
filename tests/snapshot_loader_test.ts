import { assert, assertEquals } from "./test_helpers.ts";

import {
  decodeBase64UrlToUtf8,
  isDangerousUrlScheme,
  normaliseSnapshotUrl,
} from "../docs/shared/snapshot_loader.js";

// --- normaliseSnapshotUrl ---

Deno.test("normaliseSnapshotUrl strips leading ./", () => {
  assertEquals(normaliseSnapshotUrl("./snapshot.json"), "snapshot.json");
});

Deno.test("normaliseSnapshotUrl strips repeated leading ./", () => {
  assertEquals(normaliseSnapshotUrl("././foo/bar.json"), "foo/bar.json");
});

Deno.test("normaliseSnapshotUrl collapses /./ segments", () => {
  assertEquals(normaliseSnapshotUrl("a/./b/./c.json"), "a/b/c.json");
});

Deno.test("normaliseSnapshotUrl leaves absolute URLs untouched", () => {
  const url = "https://example.com/./snapshot.json";
  assertEquals(normaliseSnapshotUrl(url), url);
});

Deno.test("normaliseSnapshotUrl leaves blob: URLs untouched", () => {
  const url = "blob:https://example.com/abc-def";
  assertEquals(normaliseSnapshotUrl(url), url);
});

Deno.test("normaliseSnapshotUrl returns empty for empty input", () => {
  assertEquals(normaliseSnapshotUrl(""), "");
  // deno-lint-ignore no-explicit-any
  assertEquals(normaliseSnapshotUrl(null as any), "");
  // deno-lint-ignore no-explicit-any
  assertEquals(normaliseSnapshotUrl(undefined as any), "");
});

Deno.test("normaliseSnapshotUrl trims whitespace", () => {
  assertEquals(normaliseSnapshotUrl("  ./foo.json  "), "foo.json");
});

// --- decodeBase64UrlToUtf8 ---

Deno.test("decodeBase64UrlToUtf8 round-trips a simple URL", () => {
  const original = "https://example.com/snapshot.json";
  const encoded = btoa(original).replaceAll("+", "-").replaceAll("/", "_")
    .replaceAll("=", "");
  assertEquals(decodeBase64UrlToUtf8(encoded), original);
});

Deno.test("decodeBase64UrlToUtf8 handles padded input", () => {
  const original = "abc";
  const encoded = btoa(original); // "YWJj"
  assertEquals(decodeBase64UrlToUtf8(encoded), original);
});

Deno.test("decodeBase64UrlToUtf8 returns null on invalid input", () => {
  assertEquals(decodeBase64UrlToUtf8("!!!not-base64!!!"), null);
});

Deno.test("decodeBase64UrlToUtf8 handles UTF-8 characters", () => {
  const original = "https://example.com/café";
  const bytes = new TextEncoder().encode(original);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  const encoded = btoa(binary).replaceAll("+", "-").replaceAll("/", "_")
    .replaceAll("=", "");
  assertEquals(decodeBase64UrlToUtf8(encoded), original);
});

// --- isDangerousUrlScheme ---

Deno.test("isDangerousUrlScheme detects javascript: scheme", () => {
  assert(isDangerousUrlScheme("javascript:alert(1)"));
  assert(isDangerousUrlScheme("JavaScript:void(0)"));
  assert(isDangerousUrlScheme("  JAVASCRIPT:foo  "));
});

Deno.test("isDangerousUrlScheme detects data: scheme", () => {
  assert(isDangerousUrlScheme("data:text/html,<h1>Hi</h1>"));
  assert(isDangerousUrlScheme("DATA:text/plain,foo"));
});

Deno.test("isDangerousUrlScheme allows safe schemes", () => {
  assertEquals(isDangerousUrlScheme("https://example.com"), false);
  assertEquals(isDangerousUrlScheme("http://example.com"), false);
  assertEquals(isDangerousUrlScheme("./snapshot.json"), false);
  assertEquals(isDangerousUrlScheme(""), false);
  // deno-lint-ignore no-explicit-any
  assertEquals(isDangerousUrlScheme(null as any), false);
  // deno-lint-ignore no-explicit-any
  assertEquals(isDangerousUrlScheme(undefined as any), false);
});
