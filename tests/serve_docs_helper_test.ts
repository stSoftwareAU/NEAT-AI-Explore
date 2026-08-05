/**
 * Issue #599 — behaviour tests for the shared `serveDocsOnFreePort()` helper.
 *
 * The six `scripts/verify_*.ts` Playwright scripts each used to inline the
 * same "bind port 0, then serve docs/ with serveDir" scaffold. These tests
 * exercise the extracted helper for real: they start the server, fetch from
 * it over HTTP, and assert the responses and shutdown behaviour.
 */

import { assert, assertEquals } from "./test_helpers.ts";
import {
  DOCS,
  REPO_ROOT,
  serveDocsOnFreePort,
} from "../scripts/lib/serve_docs.ts";

Deno.test("serveDocsOnFreePort serves docs/index.html over a loopback URL", async () => {
  const server = serveDocsOnFreePort();
  try {
    assert(
      /^http:\/\/127\.0\.0\.1:\d+\/$/.test(server.url),
      `unexpected server URL: ${server.url}`,
    );

    const res = await fetch(`${server.url}index.html`);
    const body = await res.text();
    assertEquals(res.status, 200);
    assert(
      body.includes("<html"),
      "expected docs/index.html to be served as HTML",
    );
  } finally {
    await server.shutdown();
  }
});

Deno.test("serveDocsOnFreePort returns 404 for a missing path", async () => {
  const server = serveDocsOnFreePort();
  try {
    const res = await fetch(`${server.url}definitely-not-here.txt`);
    await res.body?.cancel();
    assertEquals(res.status, 404);
  } finally {
    await server.shutdown();
  }
});

Deno.test("serveDocsOnFreePort picks a distinct free port per call", async () => {
  const a = serveDocsOnFreePort();
  const b = serveDocsOnFreePort();
  try {
    assert(a.url !== b.url, `expected distinct ports, both were ${a.url}`);
  } finally {
    await a.shutdown();
    await b.shutdown();
  }
});

Deno.test("shutdown stops the server accepting connections", async () => {
  const server = serveDocsOnFreePort();
  const url = `${server.url}index.html`;
  const res = await fetch(url);
  await res.body?.cancel();
  await server.shutdown();

  let failed = false;
  try {
    const after = await fetch(url);
    await after.body?.cancel();
  } catch {
    failed = true;
  }
  assert(failed, "expected fetch to fail after shutdown()");
});

Deno.test("REPO_ROOT and DOCS point at the published docs folder", async () => {
  assert(
    REPO_ROOT.endsWith("/"),
    `REPO_ROOT should end with '/': ${REPO_ROOT}`,
  );
  assertEquals(DOCS, `${REPO_ROOT}docs`);
  const stat = await Deno.stat(`${DOCS}/index.html`);
  assert(stat.isFile, "docs/index.html should exist");
});
