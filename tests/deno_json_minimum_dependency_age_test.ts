/**
 * Tests for the declarative dependency-age floor in `deno.json` (#616).
 *
 * The 24-hour quarantine window lived only inside
 * `scripts/jsr_quarantine_check.ts` plus an operator-editable repository
 * variable, so a reviewer reading the manifest saw no policy at all and
 * Deno's own tooling (`deno outdated --update`, `deno add`) enforced
 * nothing. `minimumDependencyAge` states the same policy where Deno reads
 * it: external packages must be at least a day old, internal
 * `stSoftwareAU` packages are exempt.
 */

import { assert, assertEquals } from "./test_helpers.ts";
import { fromFileUrl } from "@std/path";

interface MinimumDependencyAge {
  age?: string;
  exclude?: string[];
}

const DENO_JSON = fromFileUrl(new URL("../deno.json", import.meta.url));

async function readManifest(): Promise<Record<string, unknown>> {
  return JSON.parse(await Deno.readTextFile(DENO_JSON));
}

/**
 * Convert the ISO-8601 duration subset Deno accepts (`P1D`, `PT24H`,
 * `P1DT12H`) to hours. Returns `null` when the string is not a duration
 * Deno would accept — `"24 hours"` is rejected by `deno check`.
 */
export function durationToHours(age: string): number | null {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(age);
  if (!m || m[0] === "P") return null;
  const days = Number(m[1] ?? 0);
  const hours = Number(m[2] ?? 0);
  const minutes = Number(m[3] ?? 0);
  return days * 24 + hours + minutes / 60;
}

Deno.test("durationToHours reads the ISO-8601 forms Deno accepts", () => {
  assertEquals(durationToHours("P1D"), 24);
  assertEquals(durationToHours("PT24H"), 24);
  assertEquals(durationToHours("P1DT12H"), 36);
  assertEquals(durationToHours("24 hours"), null);
  assertEquals(durationToHours("P"), null);
});

Deno.test("deno.json declares a minimum dependency age of at least 24 hours (#616)", async () => {
  const manifest = await readManifest();
  const policy = manifest.minimumDependencyAge as
    | MinimumDependencyAge
    | undefined;
  assert(
    policy && typeof policy === "object",
    "deno.json must declare a `minimumDependencyAge` policy so the " +
      "quarantine window is visible to Deno's own tooling",
  );
  const hours = durationToHours(policy!.age ?? "");
  assert(
    hours !== null,
    `minimumDependencyAge.age must be an ISO-8601 duration, got: ${
      policy!.age
    }`,
  );
  assert(
    hours! >= 24,
    `minimumDependencyAge.age must be at least 24h, got ${hours}h`,
  );
});

Deno.test("the minimum-age exclusion list covers internal scopes only (#616)", async () => {
  const manifest = await readManifest();
  const exclude =
    (manifest.minimumDependencyAge as MinimumDependencyAge).exclude ?? [];
  assert(exclude.length > 0, "internal packages must be excluded by name");
  for (const pattern of exclude) {
    assert(
      /^(jsr|npm):@stsoftware(au)?\//i.test(pattern),
      `only internal stSoftwareAU scopes may bypass the age floor, got: ${pattern}`,
    );
  }
  assert(
    exclude.some((p) => p.toLowerCase().startsWith("jsr:@stsoftwareau/")),
    "the JSR internal scope used by this repo (@stsoftwareau) must be excluded",
  );
});
