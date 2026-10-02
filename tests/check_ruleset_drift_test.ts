/**
 * Tests for the ruleset drift check (#658).
 *
 * `.github/rulesets/*.json` mirror the live repository rulesets. The mirror
 * had drifted (it listed `quality` and `dependency-quarantine` while the live
 * Develop ruleset required eight different contexts), which misled a PR into
 * filtering a required workflow. These tests pin the offline comparison the
 * `ruleset-drift.yml` workflow runs against the live API.
 */

import {
  compareRuleset,
  compareRulesetSets,
  fetchLiveRulesets,
  loadCheckedInRulesets,
  parseCliArgs,
  type Ruleset,
} from "../scripts/check_ruleset_drift.ts";
import { assert, assertEquals } from "./test_helpers.ts";

/** Deep equality via JSON — `assertEquals` is strict `===`. */
function assertSame(actual: unknown, expected: unknown): void {
  assertEquals(JSON.stringify(actual), JSON.stringify(expected));
}

function liveDevelop(): Ruleset {
  return {
    id: 11243690,
    name: "Develop",
    target: "branch",
    source_type: "Repository",
    source: "owner/repo",
    enforcement: "active",
    conditions: { ref_name: { exclude: [], include: ["~DEFAULT_BRANCH"] } },
    rules: [
      { type: "deletion" },
      {
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: true,
          required_status_checks: [
            { context: "a11y", integration_id: 15368 },
            { context: "Quality Gate", integration_id: 15368 },
          ],
        },
      },
    ],
    node_id: "RRS_x",
    created_at: "2025-12-18T23:35:51.704Z",
    updated_at: "2026-09-05T21:24:18.307Z",
    current_user_can_bypass: "never",
    _links: { self: { href: "https://api.github.com/x" } },
  };
}

/** The checked-in shape: no API metadata, plus a `_comment`. */
function fileDevelop(): Ruleset {
  const r = liveDevelop();
  for (
    const k of [
      "id",
      "source_type",
      "source",
      "node_id",
      "created_at",
      "updated_at",
      "current_user_can_bypass",
      "_links",
    ]
  ) delete r[k];
  return { _comment: "mirror", ...r };
}

// deno-lint-ignore no-explicit-any
function checks(r: Ruleset): any[] {
  // deno-lint-ignore no-explicit-any
  const rule = (r.rules as any[]).find((x) =>
    x.type === "required_status_checks"
  );
  return rule.parameters.required_status_checks;
}

Deno.test("compareRuleset ignores API metadata and _comment (#658)", () => {
  assertSame(compareRuleset(fileDevelop(), liveDevelop()), []);
});

Deno.test("compareRuleset ignores array order (#658)", () => {
  const file = fileDevelop();
  checks(file).reverse();
  (file.rules as unknown[]).reverse();
  assertSame(compareRuleset(file, liveDevelop()), []);
});

Deno.test("compareRuleset reports a required check missing from the file (#658)", () => {
  const file = fileDevelop();
  checks(file).splice(0, 1); // drop a11y
  const problems = compareRuleset(file, liveDevelop());
  assertEquals(problems.length, 1, JSON.stringify(problems));
  assert(
    problems[0].includes("rules[required_status_checks]") &&
      problems[0].includes("required_status_checks[a11y]") &&
      problems[0].includes("only in live"),
    problems[0],
  );
});

Deno.test("compareRuleset reports a stale check only in the file (#658)", () => {
  const file = fileDevelop();
  checks(file).push({ context: "quality", integration_id: 15368 });
  const problems = compareRuleset(file, liveDevelop());
  assertEquals(problems.length, 1, JSON.stringify(problems));
  assert(
    problems[0].includes("[quality]") &&
      problems[0].includes("only in checked-in file"),
    problems[0],
  );
});

Deno.test("compareRuleset reports a changed scalar with both values (#658)", () => {
  const file = fileDevelop();
  file.enforcement = "evaluate";
  assertSame(compareRuleset(file, liveDevelop()), [
    'enforcement: checked-in file has "evaluate", live has "active"',
  ]);
});

Deno.test("compareRuleset skips bypass_actors only when live hides them (#658)", () => {
  // Non-admin tokens never see bypass_actors, so the file's claim cannot be
  // verified — and must not be reported as drift.
  const file = { ...fileDevelop(), bypass_actors: [] };
  assertSame(compareRuleset(file, liveDevelop()), []);
  // When the API does return them (admin token), they are compared.
  const live = {
    ...liveDevelop(),
    bypass_actors: [{ actor_id: 5, actor_type: "Team" }],
  };
  const problems = compareRuleset(file, live);
  assertEquals(problems.length, 1, JSON.stringify(problems));
  assert(problems[0].startsWith("bypass_actors"), problems[0]);
});

Deno.test("compareRulesetSets pairs rulesets by name in both directions (#658)", () => {
  const files = new Map<string, Ruleset>([
    ["develop.json", fileDevelop()],
    ["old.json", { name: "Retired", target: "branch", rules: [] }],
  ]);
  const milestone: Ruleset = {
    name: "Vibe Coder milestone branches",
    target: "branch",
    rules: [],
  };
  const problems = compareRulesetSets(files, [liveDevelop(), milestone]);
  assertSame(problems, [
    'old.json: no live ruleset named "Retired"',
    'live ruleset "Vibe Coder milestone branches" has no checked-in file',
  ]);
});

Deno.test("compareRulesetSets prefixes per-ruleset drift with the file name (#658)", () => {
  const file = fileDevelop();
  file.enforcement = "disabled";
  const problems = compareRulesetSets(
    new Map([["develop.json", file]]),
    [liveDevelop()],
  );
  assertEquals(problems.length, 1);
  assert(problems[0].startsWith("develop.json: enforcement"), problems[0]);
});

Deno.test("compareRulesetSets rejects two files claiming one name (#658)", () => {
  const problems = compareRulesetSets(
    new Map([["a.json", fileDevelop()], ["b.json", fileDevelop()]]),
    [liveDevelop()],
  );
  assert(
    problems.some((p) => p.includes("b.json") && p.includes("duplicate")),
    JSON.stringify(problems),
  );
});

Deno.test("fetchLiveRulesets lists then fetches each ruleset with the token (#658)", async () => {
  const seen: Array<{ url: string; auth: string | null }> = [];
  const fetcher = (url: string, init?: RequestInit) => {
    seen.push({
      url,
      auth: new Headers(init?.headers).get("authorization"),
    });
    const body = url.includes("/rulesets?")
      ? [{ id: 1, name: "Develop" }, { id: 2, name: "M" }]
      : { id: Number(url.split("/").pop()), name: "x", rules: [] };
    return Promise.resolve(new Response(JSON.stringify(body)));
  };
  const live = await fetchLiveRulesets("o/r", "tok", fetcher);
  assertSame(live.map((r) => r.id), [1, 2]);
  assertSame(seen.map((s) => s.url), [
    "https://api.github.com/repos/o/r/rulesets?per_page=100",
    "https://api.github.com/repos/o/r/rulesets/1",
    "https://api.github.com/repos/o/r/rulesets/2",
  ]);
  assert(seen.every((s) => s.auth === "Bearer tok"), JSON.stringify(seen));
});

Deno.test("fetchLiveRulesets fails loud on a non-OK response (#658)", async () => {
  const fetcher = () => Promise.resolve(new Response("nope", { status: 403 }));
  let error: unknown;
  try {
    await fetchLiveRulesets("o/r", undefined, fetcher);
  } catch (e) {
    error = e;
  }
  assert(error instanceof Error, "a 403 must throw, not return []");
  assert(error.message.includes("403"), error.message);
});

Deno.test("fetchLiveRulesets rejects a malformed repo slug (#658)", async () => {
  let error: unknown;
  try {
    await fetchLiveRulesets("o/r/../x", undefined, () => {
      throw new Error("must not fetch");
    });
  } catch (e) {
    error = e;
  }
  assert(error instanceof Error, "a malformed slug must throw");
  assert(error.message.includes("owner/name"), error.message);
});

Deno.test("parseCliArgs requires --repo and accepts --dir (#658)", () => {
  assertSame(parseCliArgs(["--repo", "o/r"]), {
    repo: "o/r",
    dir: ".github/rulesets",
  });
  assertSame(parseCliArgs(["--repo", "o/r", "--dir", "x"]), {
    repo: "o/r",
    dir: "x",
  });
  let error: unknown;
  try {
    parseCliArgs([]);
  } catch (e) {
    error = e;
  }
  assert(error instanceof Error && error.message.includes("--repo"));
});

Deno.test("the checked-in rulesets load and each names a ruleset (#658)", async () => {
  const files = await loadCheckedInRulesets(
    new URL("../.github/rulesets/", import.meta.url),
  );
  assertSame([...files.keys()].sort(), ["develop.json", "milestone.json"]);
  assertEquals(files.get("develop.json")?.name, "Develop");
  assertEquals(
    files.get("milestone.json")?.name,
    "Vibe Coder milestone branches",
  );
});
