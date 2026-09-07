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
  assertNever,
  checkAll,
  checkImportQuarantine,
  checkLockCoverage,
  checkLockfile,
  checkResolvedQuarantine,
  fetchLatestVersion,
  fetchLatestVersionDenoLandX,
  fetchLatestVersionNpm,
  fetchPublishTimes,
  importDisplayName,
  isInternal,
  isInternalImport,
  parseCliArgs,
  parseImports,
  parseImportSpec,
  parseLockEntry,
  parseLockfile,
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

Deno.test("parseImports extracts scope/name from JSR import specifiers", () => {
  const imports = {
    "@std/http/file-server": "jsr:@std/http@^1.0.0/file-server",
    "@std/path": "jsr:@std/path@^1.0.0",
    "@std/yaml": "jsr:@std/yaml@^1.0.0",
    "not-jsr": "npm:left-pad@^1.0.0",
  };
  const jsr = parseImports(imports).filter((i) => i.kind === "jsr");
  // Sort for stability — order does not matter
  const keys = jsr.map((p) => `@${p.scope}/${p.name}`).sort();
  assertEquals(keys.length, 3);
  assertEquals(keys[0], "@std/http");
  assertEquals(keys[1], "@std/path");
  assertEquals(keys[2], "@std/yaml");
});

Deno.test("parseImports deduplicates JSR packages referenced by multiple entrypoints", () => {
  const imports = {
    "@std/http/file-server": "jsr:@std/http@^1.0.0/file-server",
    "@std/http/server": "jsr:@std/http@^1.0.0/server",
  };
  const pkgs = parseImports(imports);
  assertEquals(pkgs.length, 1);
  assertEquals(pkgs[0].kind, "jsr");
  assertEquals(importDisplayName(pkgs[0]), "@std/http");
});

Deno.test("isInternal recognises stSoftwareAU scope (case-insensitive) as internal", () => {
  assert(isInternal({ scope: "stSoftwareAU", name: "anything" }));
  assert(isInternal({ scope: "stsoftwareau", name: "anything" }));
  assert(!isInternal({ scope: "std", name: "http" }));
  assert(!isInternal({ scope: "denoland", name: "x" }));
});

Deno.test("checkImportQuarantine flags a JSR package whose latest version is younger than the window", async () => {
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
  const r = await checkImportQuarantine(
    { kind: "jsr", scope: "std", name: "yaml" },
    f,
    now,
    24,
  );
  assertEquals(r.kind, "jsr");
  assertEquals(r.package, "@std/yaml");
  assertEquals(r.latestVersion, "1.0.5");
  assertEquals(r.inQuarantine, true);
  assert(
    r.ageHours > 5.9 && r.ageHours < 6.1,
    `expected ~6 hour age, got ${r.ageHours}`,
  );
});

Deno.test("checkImportQuarantine clears a JSR package whose latest version is older than the window", async () => {
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
  const r = await checkImportQuarantine(
    { kind: "jsr", scope: "std", name: "path" },
    f,
    now,
    24,
  );
  assertEquals(r.inQuarantine, false);
});

Deno.test("checkImportQuarantine ignores yanked JSR versions when picking the latest", async () => {
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
  const r = await checkImportQuarantine(
    { kind: "jsr", scope: "std", name: "yaml" },
    f,
    now,
    24,
  );
  assertEquals(r.latestVersion, "1.0.5");
  assertEquals(r.inQuarantine, false);
});

Deno.test("checkImportQuarantine accepts the bare-array JSR response shape", async () => {
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
  const r = await checkImportQuarantine(
    { kind: "jsr", scope: "std", name: "path" },
    f,
    now,
    24,
  );
  assertEquals(r.latestVersion, "1.0.0");
  assertEquals(r.inQuarantine, false);
});

Deno.test("checkImportQuarantine throws if the JSR registry returns a non-OK status", async () => {
  const f = fetcher({
    "https://api.jsr.io/scopes/std/packages/missing/versions": {
      status: 500,
      body: { error: "boom" },
    },
  });
  let threw = false;
  try {
    await checkImportQuarantine(
      { kind: "jsr", scope: "std", name: "missing" },
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
  assert(threw, "checkImportQuarantine should throw on non-OK status");
});

Deno.test("checkImportQuarantine throws if the JSR package has no usable (non-yanked) versions", async () => {
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
    await checkImportQuarantine(
      { kind: "jsr", scope: "std", name: "empty" },
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
  assert(
    threw,
    "checkImportQuarantine should throw when no usable versions exist",
  );
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
  // `skipped` widened from `JsrPackage[]` to `ExternalImport[]` in #223;
  // narrow on `kind` before asserting on the JSR-specific `scope`.
  const skipped = result.skipped[0];
  assertEquals(skipped.kind, "jsr");
  if (skipped.kind === "jsr") {
    assertEquals(skipped.scope, "stSoftwareAU");
  }
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

// ----------------------------------------------------------------------
// #223 — widen the gate to npm:, deno.land/x, and raw https: specifiers.
// ----------------------------------------------------------------------

Deno.test("parseImportSpec recognises jsr/npm/deno.land/x and raw URLs", () => {
  assertEquals(
    JSON.stringify(parseImportSpec("jsr:@std/path@^1.0.0")),
    JSON.stringify({ kind: "jsr", scope: "std", name: "path" }),
  );
  assertEquals(
    JSON.stringify(parseImportSpec("npm:left-pad@^1.0.0")),
    JSON.stringify({ kind: "npm", name: "left-pad" }),
  );
  assertEquals(
    JSON.stringify(parseImportSpec("npm:@playwright/test@^1.0.0")),
    JSON.stringify({ kind: "npm", name: "@playwright/test" }),
  );
  assertEquals(
    JSON.stringify(parseImportSpec("npm:playwright")),
    JSON.stringify({ kind: "npm", name: "playwright" }),
  );
  assertEquals(
    JSON.stringify(parseImportSpec("https://deno.land/x/oak@v17.0.0/mod.ts")),
    JSON.stringify({ kind: "denoland-x", name: "oak" }),
  );
  assertEquals(
    JSON.stringify(parseImportSpec("https://deno.land/x/oak/mod.ts")),
    JSON.stringify({ kind: "denoland-x", name: "oak" }),
  );
  assertEquals(
    JSON.stringify(parseImportSpec("https://example.com/foo.tar.gz")),
    JSON.stringify({ kind: "raw-url", url: "https://example.com/foo.tar.gz" }),
  );
  assertEquals(parseImportSpec("./local/file.ts"), null);
});

Deno.test("parseImports extracts and dedupes across every ecosystem", () => {
  const imports = {
    "@std/yaml": "jsr:@std/yaml@^1.0.0",
    "@std/yaml/parse": "jsr:@std/yaml@^1.0.0/parse",
    "left-pad": "npm:left-pad@^1.0.0",
    "playwright": "npm:playwright@^1.0.0",
    "oak": "https://deno.land/x/oak@v17.0.0/mod.ts",
    "blob": "https://example.com/blob.tar.gz",
    "local": "./local/file.ts",
  };
  const parsed = parseImports(imports);
  const keys = parsed
    .map((i) => importDisplayName(i))
    .sort();
  assertEquals(keys.length, 5);
  assertEquals(
    keys.join("|"),
    [
      "@std/yaml",
      "deno.land/x/oak",
      "https://example.com/blob.tar.gz",
      "npm:left-pad",
      "npm:playwright",
    ].join("|"),
  );
});

Deno.test("isInternalImport treats stSoftwareAU JSR + @stsoftwareau npm as internal", () => {
  assert(isInternalImport({
    kind: "jsr",
    scope: "stSoftwareAU",
    name: "foo",
  }));
  assert(isInternalImport({ kind: "npm", name: "@stsoftwareau/utils" }));
  assert(!isInternalImport({ kind: "jsr", scope: "std", name: "yaml" }));
  assert(!isInternalImport({ kind: "npm", name: "left-pad" }));
  assert(!isInternalImport({ kind: "denoland-x", name: "oak" }));
  assert(
    !isInternalImport({
      kind: "raw-url",
      url: "https://example.com/x",
    }),
  );
});

// `fetchLatestVersion` (the JSR fetcher) completes the symmetric trio
// alongside `fetchLatestVersionNpm` and `fetchLatestVersionDenoLandX`. It is
// part of the same stable, uniform public API, so it earns direct unit
// coverage rather than being de-exported (#351).

Deno.test("fetchLatestVersion returns the newest non-yanked JSR version", async () => {
  const f = fetcher({
    "https://api.jsr.io/scopes/std/packages/yaml/versions": {
      body: {
        items: [
          {
            version: "1.0.4",
            yanked: false,
            createdAt: "2026-05-10T00:00:00Z",
          },
          {
            version: "1.0.5",
            yanked: false,
            createdAt: "2026-05-22T06:00:00Z",
          },
        ],
      },
    },
  });
  const v = await fetchLatestVersion({ scope: "std", name: "yaml" }, f);
  assertEquals(v.version, "1.0.5");
  assertEquals(v.createdAt, "2026-05-22T06:00:00Z");
  assertEquals(v.yanked, false);
});

Deno.test("fetchLatestVersion accepts the bare-array response shape", async () => {
  const versions: VersionRecord[] = [
    { version: "1.0.0", yanked: false, createdAt: "2026-05-21T00:00:00Z" },
  ];
  const f = fetcher({
    "https://api.jsr.io/scopes/std/packages/path/versions": { body: versions },
  });
  const v = await fetchLatestVersion({ scope: "std", name: "path" }, f);
  assertEquals(v.version, "1.0.0");
});

Deno.test("fetchLatestVersion skips yanked versions when picking the latest", async () => {
  const f = fetcher({
    "https://api.jsr.io/scopes/std/packages/yaml/versions": {
      body: {
        items: [
          { version: "9.9.9", yanked: true, createdAt: "2026-05-22T11:00:00Z" },
          {
            version: "1.0.5",
            yanked: false,
            createdAt: "2026-05-01T00:00:00Z",
          },
        ],
      },
    },
  });
  const v = await fetchLatestVersion({ scope: "std", name: "yaml" }, f);
  assertEquals(v.version, "1.0.5");
});

Deno.test("fetchLatestVersion throws on a non-OK registry status", async () => {
  const f = fetcher({
    "https://api.jsr.io/scopes/std/packages/missing/versions": {
      status: 500,
      body: { error: "boom" },
    },
  });
  let threw = false;
  try {
    await fetchLatestVersion({ scope: "std", name: "missing" }, f);
  } catch (e) {
    threw = true;
    assert(
      e instanceof Error && /500/.test(e.message),
      `expected error to mention 500, got ${(e as Error).message}`,
    );
  }
  assert(threw, "expected fetchLatestVersion to throw on non-OK status");
});

Deno.test("fetchLatestVersion throws when no usable (non-yanked) versions exist", async () => {
  const f = fetcher({
    "https://api.jsr.io/scopes/std/packages/empty/versions": {
      body: {
        items: [
          { version: "0.0.1", yanked: true, createdAt: "2026-05-01T00:00:00Z" },
        ],
      },
    },
  });
  let threw = false;
  try {
    await fetchLatestVersion({ scope: "std", name: "empty" }, f);
  } catch (e) {
    threw = true;
    assert(
      e instanceof Error && /no.*version/i.test(e.message),
      `expected error to mention no versions, got ${(e as Error).message}`,
    );
  }
  assert(threw, "expected fetchLatestVersion to throw with no usable versions");
});

Deno.test("fetchLatestVersionNpm reads dist-tags.latest + time map", async () => {
  const f = fetcher({
    "https://registry.npmjs.org/left-pad": {
      body: {
        "dist-tags": { latest: "1.3.0" },
        time: {
          "1.2.0": "2026-04-01T00:00:00Z",
          "1.3.0": "2026-05-22T11:00:00Z",
        },
      },
    },
  });
  const v = await fetchLatestVersionNpm("left-pad", f);
  assertEquals(v.version, "1.3.0");
  assertEquals(v.createdAt, "2026-05-22T11:00:00Z");
  assertEquals(v.yanked, false);
});

Deno.test("fetchLatestVersionNpm throws on missing latest dist-tag", async () => {
  const f = fetcher({
    "https://registry.npmjs.org/broken": {
      body: { time: {} },
    },
  });
  let threw = false;
  try {
    await fetchLatestVersionNpm("broken", f);
  } catch (e) {
    threw = true;
    assert(
      e instanceof Error && /latest/.test(e.message),
      `expected error to mention 'latest', got ${(e as Error).message}`,
    );
  }
  assert(threw, "expected fetchLatestVersionNpm to throw");
});

Deno.test("fetchLatestVersionDenoLandX reads versions.json + meta.json", async () => {
  const f = fetcher({
    "https://cdn.deno.land/oak/meta/versions.json": {
      body: { latest: "v17.0.0", versions: ["v17.0.0", "v16.0.0"] },
    },
    "https://cdn.deno.land/oak/meta/v17.0.0/meta.json": {
      body: { uploaded_at: "2026-05-22T11:00:00Z" },
    },
  });
  const v = await fetchLatestVersionDenoLandX("oak", f);
  assertEquals(v.version, "v17.0.0");
  assertEquals(v.createdAt, "2026-05-22T11:00:00Z");
});

Deno.test("checkImportQuarantine blocks a fresh npm release", async () => {
  const now = new Date("2026-05-22T12:00:00Z");
  const f = fetcher({
    "https://registry.npmjs.org/left-pad": {
      body: {
        "dist-tags": { latest: "1.3.0" },
        time: { "1.3.0": "2026-05-22T08:00:00Z" }, // 4h ago
      },
    },
  });
  const r = await checkImportQuarantine(
    { kind: "npm", name: "left-pad" },
    f,
    now,
    24,
  );
  assertEquals(r.kind, "npm");
  assertEquals(r.package, "npm:left-pad");
  assertEquals(r.latestVersion, "1.3.0");
  assertEquals(r.inQuarantine, true);
});

Deno.test("checkImportQuarantine clears an older npm release", async () => {
  const now = new Date("2026-05-22T12:00:00Z");
  const f = fetcher({
    "https://registry.npmjs.org/left-pad": {
      body: {
        "dist-tags": { latest: "1.3.0" },
        time: { "1.3.0": "2026-05-01T00:00:00Z" }, // weeks ago
      },
    },
  });
  const r = await checkImportQuarantine(
    { kind: "npm", name: "left-pad" },
    f,
    now,
    24,
  );
  assertEquals(r.inQuarantine, false);
});

Deno.test("checkImportQuarantine blocks a fresh deno.land/x release", async () => {
  const now = new Date("2026-05-22T12:00:00Z");
  const f = fetcher({
    "https://cdn.deno.land/oak/meta/versions.json": {
      body: { latest: "v17.0.0" },
    },
    "https://cdn.deno.land/oak/meta/v17.0.0/meta.json": {
      body: { uploaded_at: "2026-05-22T06:00:00Z" }, // 6h ago
    },
  });
  const r = await checkImportQuarantine(
    { kind: "denoland-x", name: "oak" },
    f,
    now,
    24,
  );
  assertEquals(r.kind, "denoland-x");
  assertEquals(r.package, "deno.land/x/oak");
  assertEquals(r.latestVersion, "v17.0.0");
  assertEquals(r.inQuarantine, true);
});

Deno.test("checkImportQuarantine clears an older deno.land/x release", async () => {
  const now = new Date("2026-05-22T12:00:00Z");
  const f = fetcher({
    "https://cdn.deno.land/oak/meta/versions.json": {
      body: { latest: "v17.0.0" },
    },
    "https://cdn.deno.land/oak/meta/v17.0.0/meta.json": {
      body: { uploaded_at: "2026-05-01T00:00:00Z" },
    },
  });
  const r = await checkImportQuarantine(
    { kind: "denoland-x", name: "oak" },
    f,
    now,
    24,
  );
  assertEquals(r.inQuarantine, false);
});

Deno.test("checkImportQuarantine refuses raw-url imports", async () => {
  let threw = false;
  try {
    await checkImportQuarantine(
      { kind: "raw-url", url: "https://example.com/foo.tar.gz" },
      fetcher({}),
      new Date(),
      24,
    );
  } catch (e) {
    threw = true;
    assert(
      e instanceof Error && /raw URL/i.test(e.message),
      `expected raw-URL error, got ${(e as Error).message}`,
    );
  }
  assert(threw, "expected checkImportQuarantine to throw for raw-url");
});

Deno.test("checkAll routes a bare https:// specifier to unsupported (fail-closed)", async () => {
  const now = new Date("2026-05-22T12:00:00Z");
  const f = fetcher({});
  const imports = {
    "tarball": "https://example.com/foo.tar.gz",
  };
  const result = await checkAll(imports, f, now, 24);
  assertEquals(result.unsupported.length, 1);
  assertEquals(result.unsupported[0].import.kind, "raw-url");
  assert(/cannot be age-checked/.test(result.unsupported[0].reason));
  assertEquals(result.blocked.length, 0);
  assertEquals(result.cleared.length, 0);
  assertEquals(result.skipped.length, 0);
});

Deno.test("checkAll inspects every ecosystem in a mixed imports map", async () => {
  const now = new Date("2026-05-22T12:00:00Z");
  const f = fetcher({
    // JSR: cleared.
    "https://api.jsr.io/scopes/std/packages/yaml/versions": {
      body: {
        items: [{
          version: "1.0.5",
          yanked: false,
          createdAt: "2026-05-01T00:00:00Z",
        }],
      },
    },
    // npm scoped: blocked (fresh).
    "https://registry.npmjs.org/@playwright/test": {
      body: {
        "dist-tags": { latest: "1.50.0" },
        time: { "1.50.0": "2026-05-22T10:00:00Z" }, // 2h ago
      },
    },
    // deno.land/x: cleared.
    "https://cdn.deno.land/oak/meta/versions.json": {
      body: { latest: "v17.0.0" },
    },
    "https://cdn.deno.land/oak/meta/v17.0.0/meta.json": {
      body: { uploaded_at: "2026-05-01T00:00:00Z" },
    },
  });
  const imports = {
    "@std/yaml": "jsr:@std/yaml@^1.0.0",
    "@playwright/test": "npm:@playwright/test@^1.0.0",
    "oak": "https://deno.land/x/oak@v17.0.0/mod.ts",
    "@stSoftwareAU/foo": "jsr:@stSoftwareAU/foo@^1.0.0",
    "@stsoftwareau/utils": "npm:@stsoftwareau/utils@^1.0.0",
    "tarball": "https://example.com/foo.tar.gz",
  };
  const result = await checkAll(imports, f, now, 24);

  // Cleared: @std/yaml, deno.land/x/oak.
  const clearedNames = result.cleared.map((r) => r.package).sort();
  assertEquals(clearedNames.join("|"), "@std/yaml|deno.land/x/oak");
  // Blocked: @playwright/test.
  assertEquals(result.blocked.length, 1);
  assertEquals(result.blocked[0].package, "npm:@playwright/test");
  // Skipped (internal): @stSoftwareAU/foo (JSR) + @stsoftwareau/utils (npm).
  assertEquals(result.skipped.length, 2);
  // Unsupported: the raw tarball.
  assertEquals(result.unsupported.length, 1);
  assertEquals(result.unsupported[0].import.kind, "raw-url");
});

Deno.test("checkAll preserves existing JSR-only behaviour (regression)", async () => {
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
  assertEquals(result.unsupported.length, 0);
});

Deno.test("assertNever throws for an unhandled ExternalImport kind", () => {
  // Simulate a future union variant reaching a switch's default branch.
  const rogue = { kind: "future-registry", name: "x" } as unknown as never;
  let threw = false;
  let message = "";
  try {
    assertNever(rogue);
  } catch (e) {
    threw = true;
    message = (e as Error).message;
  }
  assert(threw, "assertNever should throw");
  assert(
    message.includes("Unhandled ExternalImport kind"),
    `unexpected message: ${message}`,
  );
  assert(
    message.includes("future-registry"),
    `message should include the rogue value: ${message}`,
  );
});

Deno.test("importDisplayName handles every current ExternalImport kind", () => {
  assertEquals(
    importDisplayName({ kind: "jsr", scope: "std", name: "yaml" }),
    "@std/yaml",
  );
  assertEquals(
    importDisplayName({ kind: "npm", name: "left-pad" }),
    "npm:left-pad",
  );
  assertEquals(
    importDisplayName({ kind: "denoland-x", name: "oak" }),
    "deno.land/x/oak",
  );
  assertEquals(
    importDisplayName({ kind: "raw-url", url: "https://example.com/mod.ts" }),
    "https://example.com/mod.ts",
  );
});

/* ------------------------------------------------------------------ *
 * Resolved-lockfile mode (#616)
 *
 * The scheduled bump asks "is the newest published version old enough to
 * adopt?"; a pull request must ask "is every version this branch actually
 * resolves old enough to trust?" — which covers transitive packages and
 * stays stable on unrelated PRs.
 * ------------------------------------------------------------------ */

Deno.test("parseLockEntry splits a JSR lockfile key into package and version", () => {
  const entry = parseLockEntry("jsr", "@std/yaml@1.1.1");
  assert(entry, "expected @std/yaml@1.1.1 to parse");
  assertEquals(entry!.version, "1.1.1");
  assertEquals(importDisplayName(entry!.import), "@std/yaml");
});

Deno.test("parseLockEntry splits npm keys, including scopes and peer suffixes", () => {
  const plain = parseLockEntry("npm", "jimp@1.6.1");
  assertEquals(plain!.version, "1.6.1");
  assertEquals(importDisplayName(plain!.import), "npm:jimp");

  const scoped = parseLockEntry("npm", "@jimp/core@1.6.1");
  assertEquals(scoped!.version, "1.6.1");
  assertEquals(importDisplayName(scoped!.import), "npm:@jimp/core");

  // Deno records peer-dependency resolutions after an underscore.
  const peer = parseLockEntry("npm", "@jimp/plugin-resize@1.6.1_jimp@1.6.1");
  assertEquals(peer!.version, "1.6.1");
  assertEquals(importDisplayName(peer!.import), "npm:@jimp/plugin-resize");
});

Deno.test("parseLockEntry returns null for keys it cannot parse", () => {
  assertEquals(parseLockEntry("jsr", "no-version-here"), null);
  assertEquals(parseLockEntry("jsr", "not-a-scoped-name@1.0.0"), null);
  assertEquals(parseLockEntry("npm", "@scope/name@not-a-version"), null);
  assertEquals(parseLockEntry("npm", "@scope/name"), null);
});

Deno.test("parseLockfile collects direct and transitive resolutions, deduplicated", () => {
  const { resolved, unsupported } = parseLockfile({
    jsr: {
      "@std/yaml@1.1.1": {},
      // Same package pinned twice — one entry per package@version.
      "@std/fmt@1.0.3": {},
      "@std/fmt@1.0.10": {},
    },
    npm: {
      "jimp@1.6.1": {},
      // Transitive: never named in deno.json.
      "@jimp/core@1.6.1": {},
    },
  });
  assertEquals(unsupported.length, 0);
  const names = resolved
    .map((r) => `${importDisplayName(r.import)}@${r.version}`)
    .sort();
  assertEquals(names.length, 5);
  assertEquals(names[0], "@std/fmt@1.0.10");
  assertEquals(names[1], "@std/fmt@1.0.3");
  assertEquals(names[2], "@std/yaml@1.1.1");
  assertEquals(names[3], "npm:@jimp/core@1.6.1");
  assertEquals(names[4], "npm:jimp@1.6.1");
});

Deno.test("parseLockfile reads the v3/v4 nested `packages` section", () => {
  const { resolved } = parseLockfile({
    packages: { jsr: { "@std/path@1.1.5": {} }, npm: { "left-pad@1.3.0": {} } },
  });
  const names = resolved
    .map((r) => `${importDisplayName(r.import)}@${r.version}`)
    .sort();
  assertEquals(names.length, 2);
  assertEquals(names[0], "@std/path@1.1.5");
  assertEquals(names[1], "npm:left-pad@1.3.0");
});

Deno.test("parseLockfile fails closed on remote URLs and unparseable keys", () => {
  const { resolved, unsupported } = parseLockfile({
    jsr: { "garbage-key": {} },
    remote: { "https://example.com/mod.ts": "sha256-..." },
  });
  assertEquals(resolved.length, 0);
  assertEquals(unsupported.length, 2);
  const reasons = unsupported.map((u) => u.reason).sort();
  assert(
    reasons[0].includes("raw URL dependency in deno.lock"),
    `unexpected reason: ${reasons[0]}`,
  );
  assert(
    reasons[1].includes("unparseable jsr lockfile entry"),
    `unexpected reason: ${reasons[1]}`,
  );
});

Deno.test("fetchPublishTimes maps every JSR version to its publication time", async () => {
  const f = fetcher({
    "https://api.jsr.io/scopes/std/packages/yaml/versions": {
      body: {
        items: [
          {
            version: "1.1.1",
            yanked: false,
            createdAt: "2026-05-01T00:00:00Z",
          },
          {
            version: "1.1.0",
            yanked: false,
            createdAt: "2026-04-01T00:00:00Z",
          },
        ],
      },
    },
  });
  const times = await fetchPublishTimes(
    { kind: "jsr", scope: "std", name: "yaml" },
    f,
  );
  assertEquals(times.get("1.1.1"), "2026-05-01T00:00:00Z");
  assertEquals(times.get("1.1.0"), "2026-04-01T00:00:00Z");
});

Deno.test("fetchPublishTimes maps npm versions and drops the created/modified keys", async () => {
  const f = fetcher({
    "https://registry.npmjs.org/jimp": {
      body: {
        time: {
          created: "2020-01-01T00:00:00Z",
          modified: "2026-05-01T00:00:00Z",
          "1.6.1": "2026-04-01T00:00:00Z",
        },
      },
    },
  });
  const times = await fetchPublishTimes({ kind: "npm", name: "jimp" }, f);
  assertEquals(times.size, 1);
  assertEquals(times.get("1.6.1"), "2026-04-01T00:00:00Z");
});

Deno.test("fetchPublishTimes propagates a registry error instead of returning empty", async () => {
  const f = fetcher({});
  let message = "";
  try {
    await fetchPublishTimes({ kind: "npm", name: "left-pad" }, f);
  } catch (e) {
    message = (e as Error).message;
  }
  assert(
    message.includes("npm registry returned 404"),
    `expected a loud registry failure, got: ${message}`,
  );
});

Deno.test("checkResolvedQuarantine ages the pinned version, not the latest release", () => {
  const now = new Date("2026-05-22T12:00:00Z");
  const times = new Map([
    ["1.0.0", "2026-01-01T00:00:00Z"], // pinned, long aged
    ["2.0.0", "2026-05-22T11:00:00Z"], // fresh latest — irrelevant here
  ]);
  const r = checkResolvedQuarantine(
    { import: { kind: "npm", name: "left-pad" }, version: "1.0.0" },
    times,
    now,
    24,
  );
  assertEquals(r.inQuarantine, false);
  assertEquals(r.latestVersion, "1.0.0");
  assertEquals(r.publishedAt, "2026-01-01T00:00:00Z");
});

Deno.test("checkResolvedQuarantine throws when the registry does not know the pinned version", () => {
  let message = "";
  try {
    checkResolvedQuarantine(
      { import: { kind: "jsr", scope: "std", name: "yaml" }, version: "9.9.9" },
      new Map([["1.0.0", "2026-01-01T00:00:00Z"]]),
      new Date("2026-05-22T12:00:00Z"),
      24,
    );
  } catch (e) {
    message = (e as Error).message;
  }
  assert(
    message.includes("no publication time for @std/yaml@9.9.9"),
    `expected a loud failure for the unknown version, got: ${message}`,
  );
});

Deno.test("checkLockfile blocks a freshly published transitive dependency (#616)", async () => {
  const now = new Date("2026-05-22T12:00:00Z");
  const f = fetcher({
    "https://registry.npmjs.org/jimp": {
      body: { time: { "1.6.1": "2026-01-01T00:00:00Z" } },
    },
    "https://registry.npmjs.org/@jimp/core": {
      // Transitive dependency published 30 minutes ago.
      body: { time: { "1.6.1": "2026-05-22T11:30:00Z" } },
    },
  });
  const { blocked, cleared, unsupported } = await checkLockfile(
    { npm: { "jimp@1.6.1": {}, "@jimp/core@1.6.1": {} } },
    f,
    now,
    24,
  );
  assertEquals(unsupported.length, 0);
  assertEquals(cleared.length, 1);
  assertEquals(cleared[0].package, "npm:jimp");
  assertEquals(blocked.length, 1);
  assertEquals(blocked[0].package, "npm:@jimp/core");
  assertEquals(blocked[0].latestVersion, "1.6.1");
  assert(
    blocked[0].ageHours > 0.4 && blocked[0].ageHours < 0.6,
    `expected ~0.5 hour age, got ${blocked[0].ageHours}`,
  );
});

Deno.test("checkLockfile clears a lockfile whose resolutions are all aged", async () => {
  const now = new Date("2026-05-22T12:00:00Z");
  const f = fetcher({
    "https://api.jsr.io/scopes/std/packages/yaml/versions": {
      body: {
        items: [
          {
            version: "1.1.1",
            yanked: false,
            createdAt: "2026-04-01T00:00:00Z",
          },
        ],
      },
    },
  });
  const { blocked, cleared, skipped } = await checkLockfile(
    { jsr: { "@std/yaml@1.1.1": {} } },
    f,
    now,
    24,
  );
  assertEquals(blocked.length, 0);
  assertEquals(skipped.length, 0);
  assertEquals(cleared.length, 1);
  assertEquals(cleared[0].package, "@std/yaml");
});

Deno.test("checkLockfile skips internal stSoftwareAU packages", async () => {
  const { blocked, cleared, skipped } = await checkLockfile(
    {
      jsr: { "@stsoftwareau/neat@0.1.0": {} },
      npm: { "@stsoftwareau/widget@2.0.0": {} },
    },
    fetcher({}), // any registry call would 404 and fail the test
    new Date("2026-05-22T12:00:00Z"),
    24,
  );
  assertEquals(blocked.length, 0);
  assertEquals(cleared.length, 0);
  assertEquals(skipped.length, 2);
});

Deno.test("checkLockfile fetches each package once however many versions it pins", async () => {
  let calls = 0;
  const f = (_url: string) => {
    calls++;
    return Promise.resolve(
      new Response(
        JSON.stringify({
          items: [
            {
              version: "1.0.3",
              yanked: false,
              createdAt: "2026-01-01T00:00:00Z",
            },
            {
              version: "1.0.10",
              yanked: false,
              createdAt: "2026-02-01T00:00:00Z",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
  };
  const { cleared } = await checkLockfile(
    { jsr: { "@std/fmt@1.0.3": {}, "@std/fmt@1.0.10": {} } },
    f,
    new Date("2026-05-22T12:00:00Z"),
    24,
  );
  assertEquals(cleared.length, 2);
  assertEquals(calls, 1);
});

Deno.test("checkLockCoverage flags a deno.json import missing from the lockfile", () => {
  const unsupported = checkLockCoverage(
    { "left-pad": "npm:left-pad@^1.3.0", "@std/yaml": "jsr:@std/yaml@^1.0.0" },
    [{ import: { kind: "jsr", scope: "std", name: "yaml" }, version: "1.1.1" }],
  );
  assertEquals(unsupported.length, 1);
  assertEquals(importDisplayName(unsupported[0].import), "npm:left-pad");
  assert(
    unsupported[0].reason.includes("absent from deno.lock"),
    `unexpected reason: ${unsupported[0].reason}`,
  );
});

Deno.test("checkLockCoverage fails closed on raw URL and deno.land/x specifiers", () => {
  const unsupported = checkLockCoverage(
    {
      raw: "https://example.com/mod.ts",
      oak: "https://deno.land/x/oak@v12.0.0/mod.ts",
    },
    [],
  );
  assertEquals(unsupported.length, 2);
  const names = unsupported.map((u) => importDisplayName(u.import)).sort();
  assertEquals(names[0], "deno.land/x/oak");
  assertEquals(names[1], "https://example.com/mod.ts");
});

Deno.test("checkLockCoverage ignores internal stSoftwareAU imports", () => {
  assertEquals(
    checkLockCoverage({ neat: "jsr:@stsoftwareau/neat@^0.1.0" }, []).length,
    0,
  );
});

Deno.test("checkLockfile reports a stale lockfile as unsupported, never as clean", async () => {
  const f = fetcher({
    "https://api.jsr.io/scopes/std/packages/yaml/versions": {
      body: {
        items: [
          {
            version: "1.1.1",
            yanked: false,
            createdAt: "2026-04-01T00:00:00Z",
          },
        ],
      },
    },
  });
  const { unsupported } = await checkLockfile(
    { jsr: { "@std/yaml@1.1.1": {} } },
    f,
    new Date("2026-05-22T12:00:00Z"),
    24,
    // deno.json declares a package the lockfile never resolved.
    { "@std/yaml": "jsr:@std/yaml@^1.0.0", evil: "npm:evil@^9.9.9" },
  );
  assertEquals(unsupported.length, 1);
  assertEquals(importDisplayName(unsupported[0].import), "npm:evil");
});

Deno.test("parseCliArgs defaults to deno.json in latest-published mode", () => {
  const args = parseCliArgs([]);
  assertEquals(args.denoJsonPath, "deno.json");
  assertEquals(args.lockPath, null);
  assertEquals(parseCliArgs(["custom.json"]).denoJsonPath, "custom.json");
});

Deno.test("parseCliArgs selects lockfile mode with an explicit or default path", () => {
  assertEquals(parseCliArgs(["--lock"]).lockPath, "deno.lock");
  assertEquals(parseCliArgs(["--lock=other.lock"]).lockPath, "other.lock");
  const both = parseCliArgs(["--lock", "deno.lock", "deno.json"]);
  assertEquals(both.lockPath, "deno.lock");
  assertEquals(both.denoJsonPath, "deno.json");
});

Deno.test("parseCliArgs rejects an unknown option instead of ignoring it", () => {
  let message = "";
  try {
    parseCliArgs(["--locked"]);
  } catch (e) {
    message = (e as Error).message;
  }
  assert(
    message.includes("Unknown option '--locked'"),
    `expected a loud rejection, got: ${message}`,
  );
});

/* ------------------------------------------------------------------ *
 * CLI exit codes in `--lock` mode (#616)
 *
 * The workflow's only contract with the gate is its exit status, so these
 * cases drive the real CLI end to end. Every fixture below resolves without
 * touching a registry, so the tests are deterministic and offline.
 * ------------------------------------------------------------------ */

const GATE_SCRIPT = new URL(
  "../scripts/jsr_quarantine_check.ts",
  import.meta.url,
);

async function runGate(
  denoJson: unknown,
  lock: unknown,
): Promise<{ code: number; output: string }> {
  const dir = await Deno.makeTempDir();
  try {
    const jsonPath = `${dir}/deno.json`;
    const lockPath = `${dir}/deno.lock`;
    await Deno.writeTextFile(jsonPath, JSON.stringify(denoJson));
    await Deno.writeTextFile(lockPath, JSON.stringify(lock));
    const { code, stdout, stderr } = await new Deno.Command(Deno.execPath(), {
      args: [
        // The same permission set the PR workflow grants.
        "run",
        "--allow-read",
        "--allow-env=VIBE_BUMP_QUARANTINE_HOURS",
        GATE_SCRIPT.pathname,
        "--lock",
        lockPath,
        jsonPath,
      ],
    }).output();
    const decoder = new TextDecoder();
    return {
      code,
      output: decoder.decode(stdout) + decoder.decode(stderr),
    };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("gate CLI exits 0 when every resolved version is internal", async () => {
  const { code, output } = await runGate(
    { imports: { neat: "jsr:@stsoftwareau/neat@^1.0.0" } },
    { version: "5", jsr: { "@stsoftwareau/neat@1.0.0": {} } },
  );
  assertEquals(code, 0, `expected a clean gate, got:\n${output}`);
  assert(
    output.includes("Quarantine gate (resolved versions): OK"),
    `expected the resolved-mode success line, got:\n${output}`,
  );
});

Deno.test("gate CLI exits non-zero when deno.json adds a dependency the lockfile never resolved", async () => {
  const { code, output } = await runGate(
    {
      imports: {
        neat: "jsr:@stsoftwareau/neat@^1.0.0",
        evil: "npm:evil@^9.9.9",
      },
    },
    { version: "5", jsr: { "@stsoftwareau/neat@1.0.0": {} } },
  );
  assertEquals(code, 1, `expected the gate to fail closed, got:\n${output}`);
  assert(
    output.includes("npm:evil") && output.includes("absent from deno.lock"),
    `expected the stale-lockfile failure, got:\n${output}`,
  );
});

Deno.test("gate CLI exits non-zero on a raw URL dependency it cannot age-check", async () => {
  const { code, output } = await runGate(
    { imports: {} },
    { version: "5", remote: { "https://example.com/mod.ts": "sha256-x" } },
  );
  assertEquals(code, 1, `expected the gate to fail closed, got:\n${output}`);
  assert(
    output.includes("cannot be age-checked"),
    `expected the raw-URL failure, got:\n${output}`,
  );
});
