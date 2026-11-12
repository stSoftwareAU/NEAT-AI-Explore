/**
 * Tests for CODEOWNERS coverage of privileged paths (Issue #361).
 *
 * The repo ships privileged workflows under `.github/workflows/` that run
 * with the repository's secrets and (for `deploy.yml`) an OIDC `id-token`.
 * Without a CODEOWNERS file, a single contributor could quietly alter a
 * privileged workflow to exfiltrate secrets, push to the default branch, or
 * publish attacker-controlled content to the public GitHub Pages site.
 * A CODEOWNERS rule on those paths documents who owns them. Note that
 * `require_code_owner_review` is currently `false` on the live Develop
 * ruleset (#672), so GitHub does not enforce CODEOWNERS at merge; these
 * tests do not assert that it is enforced.
 *
 * These tests parse the committed CODEOWNERS file (the source of truth), so
 * an accidental edit that drops the privileged-path coverage or the owning
 * team is caught locally.
 */

import { assert } from "./test_helpers.ts";

/** GitHub recognises CODEOWNERS in these three locations, in this order. */
const CODEOWNERS_LOCATIONS = [
  ".github/CODEOWNERS",
  "CODEOWNERS",
  "docs/CODEOWNERS",
];

/** The reviewing team mirrors the `developers` team (id 2166335) already
 * named as the required reviewer in `.github/rulesets/develop.json`. */
const REVIEWING_TEAM = "@stSoftwareAU/developers";

/** Privileged paths that must be owned by the reviewing team. */
const PRIVILEGED_PATHS = [
  "/.github/workflows/",
  "/.github/actions/",
  "/.github/rulesets/",
];

interface CodeownersRule {
  pattern: string;
  owners: string[];
}

async function locateCodeowners(): Promise<string | undefined> {
  for (const loc of CODEOWNERS_LOCATIONS) {
    const url = new URL(`../${loc}`, import.meta.url);
    try {
      const stat = await Deno.stat(url);
      if (stat.isFile) return loc;
    } catch {
      // try next location
    }
  }
  return undefined;
}

async function loadCodeownersRules(): Promise<CodeownersRule[]> {
  const loc = await locateCodeowners();
  assert(
    loc,
    `a CODEOWNERS file must exist in one of: ${
      CODEOWNERS_LOCATIONS.join(", ")
    }`,
  );
  const url = new URL(`../${loc}`, import.meta.url);
  const text = await Deno.readTextFile(url);
  const rules: CodeownersRule[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    const [pattern, ...owners] = parts;
    rules.push({ pattern, owners });
  }
  return rules;
}

Deno.test("a CODEOWNERS file exists in a GitHub-recognised location (#361)", async () => {
  const loc = await locateCodeowners();
  assert(
    loc,
    `CODEOWNERS missing; expected one of: ${CODEOWNERS_LOCATIONS.join(", ")}`,
  );
});

Deno.test("CODEOWNERS covers every privileged path (#361)", async () => {
  const rules = await loadCodeownersRules();
  const patterns = rules.map((r) => r.pattern);
  for (const path of PRIVILEGED_PATHS) {
    assert(
      patterns.includes(path),
      `CODEOWNERS must include a rule for ${path}, got: ${
        JSON.stringify(patterns)
      }`,
    );
  }
});

Deno.test("each privileged path names the reviewing team as owner (#361)", async () => {
  const rules = await loadCodeownersRules();
  for (const path of PRIVILEGED_PATHS) {
    const rule = rules.find((r) => r.pattern === path);
    assert(rule, `CODEOWNERS must include a rule for ${path}`);
    assert(
      rule!.owners.includes(REVIEWING_TEAM),
      `${path} must be owned by ${REVIEWING_TEAM}, got: ${
        JSON.stringify(rule!.owners)
      }`,
    );
  }
});

Deno.test("every CODEOWNERS rule names at least one owner (#361)", async () => {
  const rules = await loadCodeownersRules();
  for (const rule of rules) {
    assert(
      rule.owners.length > 0,
      `CODEOWNERS rule for ${rule.pattern} must name at least one owner`,
    );
  }
});
