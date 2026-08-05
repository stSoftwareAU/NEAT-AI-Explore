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
  fetchLatestVersion,
  fetchLatestVersionDenoLandX,
  fetchLatestVersionNpm,
  importDisplayName,
  isInternal,
  isInternalImport,
  parseImports,
  parseImportSpec,
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
