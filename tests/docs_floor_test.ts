/**
 * Tests for repo "docs floor" hygiene files (#207).
 *
 * Verifies the presence of CONTRIBUTING.md and CHANGELOG.md so the public
 * repo meets the Open Source Guides docs floor.
 *
 * Note (#331): the previous keyword greps over the prose of these files
 * (e.g. `text.includes("deno fmt")`, `includes("keep a changelog")`) were
 * removed. They were grep-as-assertions coupled to exact wording — they
 * broke on routine rewording without any functional regression, and the
 * loose matches could stay green while the surrounding guidance was wrong.
 * Only the durable structural check — that each file exists — is kept.
 */

import { assert } from "./test_helpers.ts";

const CONTRIBUTING_PATH = new URL("../CONTRIBUTING.md", import.meta.url);
const CHANGELOG_PATH = new URL("../CHANGELOG.md", import.meta.url);

Deno.test("CONTRIBUTING.md exists at repo root", async () => {
  const stat = await Deno.stat(CONTRIBUTING_PATH);
  assert(stat.isFile, "expected CONTRIBUTING.md to be a regular file");
});

Deno.test("CHANGELOG.md exists at repo root", async () => {
  const stat = await Deno.stat(CHANGELOG_PATH);
  assert(stat.isFile, "expected CHANGELOG.md to be a regular file");
});
