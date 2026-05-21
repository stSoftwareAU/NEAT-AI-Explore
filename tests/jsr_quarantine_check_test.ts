/**
 * Tests for the JSR dependency quarantine gate (#189).
 *
 * The gate inspects deno.json's JSR imports and queries the JSR registry for
 * each external package's most-recent publication time. If any external
 * package's latest version was published less than VIBE_BUMP_QUARANTINE_HOURS
 * (default 24) hours ago, the gate blocks the upgrade. stSoftwareAU/* scopes
 * are treated as internal and bypass the gate per house policy.
 */

import {
  checkAll,
  checkQuarantine,
  isInternal,
  parseJsrImports,
  type VersionRecord,
} from "../scripts/jsr_quarantine_check.ts";
import { assert, assertEquals } from "./test_helpers.ts";

function fetcher(
  responses: Record<string, { status?: number; body: unknown }>,
): (url: string) => Promise<Response> {
  return (url: string) => {
    const r = responses[url];
    if (!r) {
      return Promise.resolve(
        new Response("not found", { status: 404 }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify(r.body), {
        status: r.status ?? 200,
        headers: { "content-type": "application/json" },
      }),
    );
  };
}

Deno.test("parseJsrImports extracts scope/name from import specifiers", () => {
  const imports = {
    "@std/http/file-server": "jsr:@std/http@^1.0.0/file-server",
    "@std/path": "jsr:@std/path@^1.0.0",
    "@std/yaml": "jsr:@std/yaml@^1.0.0",
    "not-jsr": "npm:left-pad@^1.0.0",
  };
  const pkgs = parseJsrImports(imports);
  // Sort for stability — order does not matter
  const keys = pkgs.map((p) => `@${p.scope}/${p.name}`).sort();
  assertEquals(keys.length, 3);
  assertEquals(keys[0], "@std/http");
  assertEquals(keys[1], "@std/path");
  assertEquals(keys[2], "@std/yaml");
});

Deno.test("parseJsrImports deduplicates packages referenced by multiple entrypoints", () => {
  const imports = {
    "@std/http/file-server": "jsr:@std/http@^1.0.0/file-server",
    "@std/http/server": "jsr:@std/http@^1.0.0/server",
  };
  const pkgs = parseJsrImports(imports);
  assertEquals(pkgs.length, 1);
  assertEquals(pkgs[0].scope, "std");
  assertEquals(pkgs[0].name, "http");
});

Deno.test("isInternal recognises stSoftwareAU scope (case-insensitive) as internal", () => {
  assert(isInternal({ scope: "stSoftwareAU", name: "anything" }));
  assert(isInternal({ scope: "stsoftwareau", name: "anything" }));
  assert(!isInternal({ scope: "std", name: "http" }));
  assert(!isInternal({ scope: "denoland", name: "x" }));
});

Deno.test("checkQuarantine flags a package whose latest version is younger than the window", async () => {
  const now = new Date("2026-05-22T12:00:00Z");
  const versions: VersionRecord[] = [
    {
      version: "1.0.5",
      yanked: false,
      createdAt: "2026-05-22T06:00:00Z", // 6h ago
    },
    {
      version: "1.0.4",
      yanked: false,
      createdAt: "2026-05-10T00:00:00Z",
    },
  ];
  const f = fetcher({
    "https://api.jsr.io/scopes/std/packages/yaml/versions": {
      body: { items: versions },
    },
  });
  const r = await checkQuarantine(
    { scope: "std", name: "yaml" },
    f,
    now,
    24,
  );
  assertEquals(r.package, "@std/yaml");
  assertEquals(r.latestVersion, "1.0.5");
  assertEquals(r.inQuarantine, true);
  assert(
    r.ageHours > 5.9 && r.ageHours < 6.1,
    `expected ~6 hour age, got ${r.ageHours}`,
  );
});

Deno.test("checkQuarantine clears a package whose latest version is older than the window", async () => {
  const now = new Date("2026-05-22T12:00:00Z");
  const versions: VersionRecord[] = [
    {
      version: "1.0.5",
      yanked: false,
      createdAt: "2026-05-20T00:00:00Z", // 60h ago
    },
  ];
  const f = fetcher({
    "https://api.jsr.io/scopes/std/packages/path/versions": {
      body: { items: versions },
    },
  });
  const r = await checkQuarantine(
    { scope: "std", name: "path" },
    f,
    now,
    24,
  );
  assertEquals(r.inQuarantine, false);
});

Deno.test("checkQuarantine ignores yanked versions when picking the latest", async () => {
  const now = new Date("2026-05-22T12:00:00Z");
  const versions: VersionRecord[] = [
    {
      version: "9.9.9",
      yanked: true,
      createdAt: "2026-05-22T11:00:00Z", // 1h ago but yanked
    },
    {
      version: "1.0.5",
      yanked: false,
      createdAt: "2026-05-01T00:00:00Z", // > 24h ago
    },
  ];
  const f = fetcher({
    "https://api.jsr.io/scopes/std/packages/yaml/versions": {
      body: { items: versions },
    },
  });
  const r = await checkQuarantine(
    { scope: "std", name: "yaml" },
    f,
    now,
    24,
  );
  assertEquals(r.latestVersion, "1.0.5");
  assertEquals(r.inQuarantine, false);
});

Deno.test("checkQuarantine accepts bare-array response shape", async () => {
  const now = new Date("2026-05-22T12:00:00Z");
  const versions: VersionRecord[] = [
    {
      version: "1.0.0",
      yanked: false,
      createdAt: "2026-05-21T00:00:00Z", // 36h ago
    },
  ];
  const f = fetcher({
    "https://api.jsr.io/scopes/std/packages/path/versions": {
      body: versions,
    },
  });
  const r = await checkQuarantine(
    { scope: "std", name: "path" },
    f,
    now,
    24,
  );
  assertEquals(r.latestVersion, "1.0.0");
  assertEquals(r.inQuarantine, false);
});

Deno.test("checkQuarantine throws if the registry returns a non-OK status", async () => {
  const f = fetcher({
    "https://api.jsr.io/scopes/std/packages/missing/versions": {
      status: 500,
      body: { error: "boom" },
    },
  });
  let threw = false;
  try {
    await checkQuarantine(
      { scope: "std", name: "missing" },
      f,
      new Date(),
      24,
    );
  } catch (e) {
    threw = true;
    assert(
      e instanceof Error && /500/.test(e.message),
      `expected error to mention 500, got ${(e as Error).message}`,
    );
  }
  assert(threw, "checkQuarantine should throw on non-OK status");
});

Deno.test("checkQuarantine throws if the package has no usable (non-yanked) versions", async () => {
  const f = fetcher({
    "https://api.jsr.io/scopes/std/packages/empty/versions": {
      body: {
        items: [
          {
            version: "0.0.1",
            yanked: true,
            createdAt: "2026-05-01T00:00:00Z",
          },
        ],
      },
    },
  });
  let threw = false;
  try {
    await checkQuarantine(
      { scope: "std", name: "empty" },
      f,
      new Date(),
      24,
    );
  } catch (e) {
    threw = true;
    assert(
      e instanceof Error && /no.*version/i.test(e.message),
      `expected error to mention no versions, got ${(e as Error).message}`,
    );
  }
  assert(threw, "checkQuarantine should throw when no usable versions exist");
});

Deno.test("checkAll skips stSoftwareAU packages and reports cleared vs blocked", async () => {
  const now = new Date("2026-05-22T12:00:00Z");
  const f = fetcher({
    "https://api.jsr.io/scopes/std/packages/yaml/versions": {
      body: {
        items: [{
          version: "1.0.5",
          yanked: false,
          createdAt: "2026-05-22T11:00:00Z", // 1h ago — blocked
        }],
      },
    },
    "https://api.jsr.io/scopes/std/packages/path/versions": {
      body: {
        items: [{
          version: "1.0.5",
          yanked: false,
          createdAt: "2026-05-01T00:00:00Z", // older — cleared
        }],
      },
    },
  });
  const imports = {
    "@std/yaml": "jsr:@std/yaml@^1.0.0",
    "@std/path": "jsr:@std/path@^1.0.0",
    "@stSoftwareAU/foo": "jsr:@stSoftwareAU/foo@^1.0.0",
  };
  const result = await checkAll(imports, f, now, 24);
  assertEquals(result.blocked.length, 1);
  assertEquals(result.blocked[0].package, "@std/yaml");
  assertEquals(result.cleared.length, 1);
  assertEquals(result.cleared[0].package, "@std/path");
  assertEquals(result.skipped.length, 1);
  assertEquals(result.skipped[0].scope, "stSoftwareAU");
});

Deno.test("checkAll honours the configured quarantine window", async () => {
  const now = new Date("2026-05-22T12:00:00Z");
  const f = fetcher({
    "https://api.jsr.io/scopes/std/packages/yaml/versions": {
      body: {
        items: [{
          version: "1.0.0",
          yanked: false,
          createdAt: "2026-05-22T02:00:00Z", // 10h ago
        }],
      },
    },
  });
  const imports = { "@std/yaml": "jsr:@std/yaml@^1.0.0" };

  // 24h window — blocked
  const blocked = await checkAll(imports, f, now, 24);
  assertEquals(blocked.blocked.length, 1);
  assertEquals(blocked.cleared.length, 0);

  // 8h window — cleared
  const cleared = await checkAll(imports, f, now, 8);
  assertEquals(cleared.blocked.length, 0);
  assertEquals(cleared.cleared.length, 1);
});
