/**
 * Tests for GitHub Action runner currency.
 *
 * The SHA-pinning policy (#190) guarantees every `uses:` is pinned to a
 * 40-char commit SHA, but pinning alone does not stop a workflow from lagging
 * on a build that runs on the deprecated Node.js 20 runtime — GitHub flipped
 * the runner default to Node 24 on 2026-06-02 and removes Node 20 entirely on
 * 2026-09-16. Because each pin is a commit SHA, no tag movement will ever pull
 * in a fixed runtime, so the break is guaranteed unless the pin is bumped.
 *
 * Each action below must resolve to the current Node 24 build and must never
 * resolve to the recorded deprecated Node 20 build.
 *
 * One data-driven suite replaces the eight near-identical per-action files
 * that previously carried this policy (#588); each case keeps its originating
 * issue reference as the step name, so the per-issue provenance survives.
 */

import { assert, assertEquals } from "./test_helpers.ts";
import { collectActionRefs } from "./workflow_helpers.ts";

interface Case {
  /** Action name without the `@<sha>` suffix. */
  action: string;
  /** SHA of the last known Node 20 build, which must never be pinned. */
  deprecatedSha: string;
  /** SHA of the current Node 24 build, which every reference must pin. */
  node24Sha: string;
  /** Release label of `node24Sha`, for the failure message. */
  node24Version: string;
  ref: string;
}

const CASES: Case[] = [
  {
    action: "actions/setup-node",
    deprecatedSha: "49933ea5288caeca8642d1e84afbd3f7d6820020", // v4
    node24Sha: "48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e",
    node24Version: "v6.4.0",
    ref: "#294",
  },
  {
    action: "actions/configure-pages",
    deprecatedSha: "1f0c5cde4bc74cd7e1254d0cb4de8d49e9068c7d", // v4.0.0
    node24Sha: "45bfe0192ca1faeb007ade9deae92b16b8254a0d",
    node24Version: "v6.0.0",
    ref: "#295",
  },
  {
    action: "actions/deploy-pages",
    deprecatedSha: "d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e", // v4.0.5
    node24Sha: "cd2ce8fcbc39b97be8ca5fce6e763baed58fa128",
    node24Version: "v5.0.0",
    ref: "#296",
  },
  {
    action: "actions/upload-pages-artifact",
    deprecatedSha: "56afc609e74202658d3ffba0e8f6dda462b719fa", // v3.0.1
    node24Sha: "fc324d3547104276b827a68afc52ff2a11cc49c9",
    node24Version: "v5.0.0",
    ref: "#297",
  },
  {
    action: "gitleaks/gitleaks-action",
    deprecatedSha: "ff98106e4c7b2bc287b24eaf42907196329070c7", // v2.3.9
    node24Sha: "e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e",
    node24Version: "v3.0.0",
    ref: "#298",
  },
  {
    action: "actions/dependency-review-action",
    deprecatedSha: "2031cfc080254a8a887f58cffee85186f0e49e48", // v4.9.0
    node24Sha: "a1d282b36b6f3519aa1f3fc636f609c47dddb294",
    node24Version: "v5.0.0",
    ref: "#299",
  },
  {
    action: "actions/upload-artifact",
    deprecatedSha: "ea165f8d65b6e75b540449e92b4886f43607fa02", // v4.6.2
    node24Sha: "043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
    node24Version: "v7.0.1",
    ref: "#555",
  },
  {
    action: "peter-evans/create-pull-request",
    deprecatedSha: "22a9089034f40e5a961c8808d113e2c98fb63676", // v7.0.11
    node24Sha: "5f6978faf089d4d20b00c7766989d076bb2fc7f1",
    node24Version: "v8.1.1",
    ref: "#556",
  },
];

function describe(refs: Array<[string, string]>): string {
  return refs.map(([file, sha]) => `${file}: ${sha}`).join("\n  ");
}

Deno.test("each tracked action is still referenced by a workflow", async (t) => {
  for (const c of CASES) {
    await t.step(`${c.action} (${c.ref})`, async () => {
      const refs = await collectActionRefs(c.action);
      assert(
        refs.length > 0,
        `expected at least one ${c.action} reference`,
      );
    });
  }
});

Deno.test("no workflow pins a deprecated Node 20 build", async (t) => {
  for (const c of CASES) {
    await t.step(`${c.action} (${c.ref})`, async () => {
      const refs = await collectActionRefs(c.action);
      const offenders = refs.filter(([, sha]) => sha === c.deprecatedSha);
      assertEquals(
        offenders.length,
        0,
        `Found deprecated Node 20 ${c.action} pin(s):\n  ${
          describe(offenders)
        }`,
      );
    });
  }
});

Deno.test("every reference pins the Node 24 build", async (t) => {
  for (const c of CASES) {
    await t.step(`${c.action} (${c.ref})`, async () => {
      const refs = await collectActionRefs(c.action);
      const wrong = refs.filter(([, sha]) => sha !== c.node24Sha);
      assertEquals(
        wrong.length,
        0,
        `Expected every ${c.action} pin to resolve to ${c.node24Sha} (${c.node24Version}, Node 24), found:\n  ${
          describe(refs)
        }`,
      );
    });
  }
});
