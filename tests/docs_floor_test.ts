/**
 * Tests for repo "docs floor" hygiene files (#207).
 *
 * Verifies the presence and shape of CONTRIBUTING.md and CHANGELOG.md so
 * the public repo meets the Open Source Guides docs floor.
 */

import { assert } from "./test_helpers.ts";

const CONTRIBUTING_PATH = new URL("../CONTRIBUTING.md", import.meta.url);
const CHANGELOG_PATH = new URL("../CHANGELOG.md", import.meta.url);

async function readText(url: URL): Promise<string> {
  return await Deno.readTextFile(url);
}

Deno.test("CONTRIBUTING.md exists at repo root", async () => {
  const stat = await Deno.stat(CONTRIBUTING_PATH);
  assert(stat.isFile, "expected CONTRIBUTING.md to be a regular file");
});

Deno.test("CONTRIBUTING.md documents the Develop branch workflow", async () => {
  const text = await readText(CONTRIBUTING_PATH);
  assert(
    text.includes("Develop"),
    "CONTRIBUTING.md should mention the Develop branch",
  );
});

Deno.test("CONTRIBUTING.md documents how to run quality.sh", async () => {
  const text = await readText(CONTRIBUTING_PATH);
  assert(
    text.includes("./quality.sh") || text.includes("quality.sh"),
    "CONTRIBUTING.md should mention quality.sh",
  );
});

Deno.test("CONTRIBUTING.md documents deno fmt and deno lint", async () => {
  const text = await readText(CONTRIBUTING_PATH);
  assert(
    text.includes("deno fmt"),
    "CONTRIBUTING.md should mention deno fmt",
  );
  assert(
    text.includes("deno lint"),
    "CONTRIBUTING.md should mention deno lint",
  );
});

Deno.test("CONTRIBUTING.md documents the PR-summary convention", async () => {
  const text = await readText(CONTRIBUTING_PATH);
  assert(
    text.includes("docs/pr-summary-"),
    "CONTRIBUTING.md should mention the docs/pr-summary-NNN.md convention",
  );
});

Deno.test("CHANGELOG.md exists at repo root", async () => {
  const stat = await Deno.stat(CHANGELOG_PATH);
  assert(stat.isFile, "expected CHANGELOG.md to be a regular file");
});

Deno.test("CHANGELOG.md follows keepachangelog.com format", async () => {
  const text = await readText(CHANGELOG_PATH);
  assert(
    text.toLowerCase().includes("keep a changelog") ||
      text.includes("keepachangelog.com"),
    "CHANGELOG.md should reference Keep a Changelog format",
  );
  // Standard sections from keepachangelog.com
  assert(
    text.includes("## ["),
    "CHANGELOG.md should contain at least one version section like ## [0.1.0]",
  );
});
