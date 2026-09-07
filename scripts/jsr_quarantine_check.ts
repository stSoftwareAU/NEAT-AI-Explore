/**
 * External dependency quarantine gate (#189, widened in #223).
 *
 * Read deno.json's `imports` map, identify every external package across
 * every supported ecosystem (JSR, npm, deno.land/x), and query each
 * registry for its most recently published, non-yanked version. If any
 * external package's latest version was published less than
 * VIBE_BUMP_QUARANTINE_HOURS (default 24) hours ago, exit non-zero so
 * the scheduled upgrade workflow halts before `deno outdated --update
 * --latest` can ingest a freshly-published (potentially malicious)
 * version.
 *
 * Bare `https://` / `http://` URL specifiers (raw tarballs, gists,
 * etc.) cannot be age-checked, so the gate fail-closes on them and
 * refuses to update.
 *
 * Per house policy, `stSoftwareAU/*` is treated as internal and bypasses
 * the gate for JSR; the equivalent bypass for npm applies only when the
 * package is published under the `@stsoftwareau` scope. All other
 * scopes — including `@std/*` — are external.
 *
 * Two modes (#616):
 *
 * - Default (pre-bump): age-check the *latest* published version of each
 *   direct import, so the weekly bump refuses to ingest a fresh release.
 * - `--lock` (pull request): age-check every *resolved* version in
 *   `deno.lock`, direct and transitive, so a PR that hand-edits
 *   `deno.json`/`deno.lock` cannot adopt a minutes-old package with no
 *   publish-age verification.
 *
 * Usage:
 *   deno run --allow-read \
 *     --allow-net=api.jsr.io,registry.npmjs.org,cdn.deno.land,deno.land \
 *     scripts/jsr_quarantine_check.ts [deno.json]
 *
 *   deno run --allow-read \
 *     --allow-net=api.jsr.io,registry.npmjs.org \
 *     scripts/jsr_quarantine_check.ts --lock deno.lock deno.json
 */

export interface JsrPackage {
  scope: string;
  name: string;
}

export type ExternalImport =
  | { kind: "jsr"; scope: string; name: string }
  | { kind: "npm"; name: string }
  | { kind: "denoland-x"; name: string }
  | { kind: "raw-url"; url: string };

export interface VersionRecord {
  version: string;
  yanked: boolean;
  createdAt: string;
}

export interface QuarantineResult {
  kind: "jsr" | "npm" | "denoland-x";
  package: string;
  latestVersion: string;
  publishedAt: string;
  ageHours: number;
  inQuarantine: boolean;
}

export interface UnsupportedImport {
  import: ExternalImport;
  reason: string;
}

export type Fetcher = (url: string) => Promise<Response>;

/** Match `jsr:@scope/name` at the start of an import specifier. */
const JSR_SPEC = /^jsr:@([^/]+)\/([^@/]+)/;

/**
 * Match `npm:<name>` at the start of a specifier. Captures either an
 * unscoped name (`left-pad`) or a scoped name (`@scope/name`). Stops at
 * the version separator (`@`), a subpath (`/`), or end-of-string.
 */
const NPM_SPEC = /^npm:(@[^/@]+\/[^/@]+|[^/@]+)(?:@|\/|$)/;

/**
 * Match `https://deno.land/x/<name>[@version]/...` and capture the
 * module name (the part before `@` or the next `/`).
 */
const DENO_LAND_X_SPEC = /^https?:\/\/deno\.land\/x\/([^@/]+)/;

/**
 * Parse a single import specifier into a typed `ExternalImport`. Returns
 * `null` for specifiers we deliberately ignore (relative paths,
 * unrecognised schemes that are not http(s)).
 */
export function parseImportSpec(spec: string): ExternalImport | null {
  let m: RegExpExecArray | null;
  if ((m = JSR_SPEC.exec(spec))) {
    return { kind: "jsr", scope: m[1], name: m[2] };
  }
  if ((m = NPM_SPEC.exec(spec))) {
    return { kind: "npm", name: m[1] };
  }
  if ((m = DENO_LAND_X_SPEC.exec(spec))) {
    return { kind: "denoland-x", name: m[1] };
  }
  if (/^https?:\/\//.test(spec)) {
    return { kind: "raw-url", url: spec };
  }
  return null;
}

/**
 * Exhaustiveness guard for `ExternalImport.kind` switches. If a new
 * variant is added to the union without a matching `case`, the `default`
 * branch that calls this helper fails to type-check (the argument is no
 * longer `never`), turning a future variant into a localised compile
 * error rather than a silent runtime bug.
 */
export function assertNever(x: never): never {
  throw new Error(`Unhandled ExternalImport kind: ${JSON.stringify(x)}`);
}

/** Stable dedup key for an `ExternalImport`. */
function importKey(imp: ExternalImport): string {
  switch (imp.kind) {
    case "jsr":
      return `jsr:@${imp.scope}/${imp.name}`;
    case "npm":
      return `npm:${imp.name}`;
    case "denoland-x":
      return `denoland-x:${imp.name}`;
    case "raw-url":
      return `raw:${imp.url}`;
    default:
      return assertNever(imp);
  }
}

/** Human-readable display name for logging. */
export function importDisplayName(imp: ExternalImport): string {
  switch (imp.kind) {
    case "jsr":
      return `@${imp.scope}/${imp.name}`;
    case "npm":
      return `npm:${imp.name}`;
    case "denoland-x":
      return `deno.land/x/${imp.name}`;
    case "raw-url":
      return imp.url;
    default:
      return assertNever(imp);
  }
}

/** Extract every distinct external package, across all ecosystems. */
export function parseImports(
  imports: Record<string, string>,
): ExternalImport[] {
  const seen = new Map<string, ExternalImport>();
  for (const spec of Object.values(imports)) {
    const imp = parseImportSpec(spec);
    if (!imp) continue;
    const key = importKey(imp);
    if (!seen.has(key)) seen.set(key, imp);
  }
  return [...seen.values()];
}

/** stSoftwareAU/* is internal per VIBE_BUMP_QUARANTINE_HOURS policy. */
export function isInternal(pkg: JsrPackage): boolean {
  return pkg.scope.toLowerCase() === "stsoftwareau";
}

/**
 * Whether an external import counts as internal per house policy.
 *
 * - JSR: any `@stsoftwareau/*` package.
 * - npm: only npm packages published under the `@stsoftwareau` scope.
 * - deno.land/x and raw URLs: no internal bypass — deno.land/x names
 *   are not tied to a GitHub org, and raw URLs are always fail-closed.
 */
export function isInternalImport(imp: ExternalImport): boolean {
  if (imp.kind === "jsr") {
    return isInternal({ scope: imp.scope, name: imp.name });
  }
  if (imp.kind === "npm") {
    return imp.name.toLowerCase().startsWith("@stsoftwareau/");
  }
  return false;
}

/**
 * Query the JSR registry for the latest non-yanked version of a package.
 *
 * Accepts both the `{ items: [...] }` and bare-array response shapes that
 * different JSR endpoints have returned at various times.
 */
export async function fetchLatestVersion(
  pkg: JsrPackage,
  fetcher: Fetcher,
): Promise<VersionRecord> {
  const url =
    `https://api.jsr.io/scopes/${pkg.scope}/packages/${pkg.name}/versions`;
  const res = await fetcher(url);
  if (!res.ok) {
    throw new Error(
      `JSR registry returned ${res.status} for @${pkg.scope}/${pkg.name}`,
    );
  }
  const data = await res.json() as
    | { items?: VersionRecord[] }
    | VersionRecord[];
  const items: VersionRecord[] = Array.isArray(data)
    ? data
    : (data.items ?? []);
  const usable = items.filter((v) => v && !v.yanked && v.createdAt);
  if (usable.length === 0) {
    throw new Error(
      `no usable (non-yanked) versions found for @${pkg.scope}/${pkg.name}`,
    );
  }
  usable.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return usable[0];
}

/**
 * Query the npm registry for the latest published version of a package
 * and its publication time. Uses the `dist-tags.latest` pointer plus the
 * `time` map returned by `https://registry.npmjs.org/<name>`.
 */
export async function fetchLatestVersionNpm(
  name: string,
  fetcher: Fetcher,
): Promise<VersionRecord> {
  const url = `https://registry.npmjs.org/${name}`;
  const res = await fetcher(url);
  if (!res.ok) {
    throw new Error(
      `npm registry returned ${res.status} for ${name}`,
    );
  }
  const data = await res.json() as {
    "dist-tags"?: { latest?: string };
    time?: Record<string, string>;
  };
  const latest = data["dist-tags"]?.latest;
  if (!latest) {
    throw new Error(`npm registry returned no 'latest' dist-tag for ${name}`);
  }
  const createdAt = data.time?.[latest];
  if (!createdAt) {
    throw new Error(
      `npm registry returned no publish time for ${name}@${latest}`,
    );
  }
  return { version: latest, yanked: false, createdAt };
}

/**
 * Query the deno.land/x registry for the latest version of a module and
 * its upload time. Two requests: `versions.json` for the `latest`
 * pointer, then `meta.json` for that version's `uploaded_at`.
 */
export async function fetchLatestVersionDenoLandX(
  name: string,
  fetcher: Fetcher,
): Promise<VersionRecord> {
  const versionsUrl = `https://cdn.deno.land/${name}/meta/versions.json`;
  const vRes = await fetcher(versionsUrl);
  if (!vRes.ok) {
    throw new Error(
      `deno.land/x returned ${vRes.status} for ${name} versions.json`,
    );
  }
  const versionsData = await vRes.json() as { latest?: string };
  const latest = versionsData.latest;
  if (!latest) {
    throw new Error(`deno.land/x returned no 'latest' for ${name}`);
  }
  const metaUrl = `https://cdn.deno.land/${name}/meta/${latest}/meta.json`;
  const mRes = await fetcher(metaUrl);
  if (!mRes.ok) {
    throw new Error(
      `deno.land/x returned ${mRes.status} for ${name}@${latest} meta.json`,
    );
  }
  const meta = await mRes.json() as { uploaded_at?: string };
  if (!meta.uploaded_at) {
    throw new Error(
      `deno.land/x returned no uploaded_at for ${name}@${latest}`,
    );
  }
  return { version: latest, yanked: false, createdAt: meta.uploaded_at };
}

/**
 * Generic quarantine check that routes to the correct registry helper
 * based on the import's ecosystem. Throws if called for a `raw-url`
 * import (which the caller must fail-close on instead).
 */
export async function checkImportQuarantine(
  imp: ExternalImport,
  fetcher: Fetcher,
  now: Date,
  quarantineHours: number,
): Promise<QuarantineResult> {
  let v: VersionRecord;
  let kind: QuarantineResult["kind"];
  let display: string;
  switch (imp.kind) {
    case "jsr":
      v = await fetchLatestVersion(
        { scope: imp.scope, name: imp.name },
        fetcher,
      );
      kind = "jsr";
      display = `@${imp.scope}/${imp.name}`;
      break;
    case "npm":
      v = await fetchLatestVersionNpm(imp.name, fetcher);
      kind = "npm";
      display = `npm:${imp.name}`;
      break;
    case "denoland-x":
      v = await fetchLatestVersionDenoLandX(imp.name, fetcher);
      kind = "denoland-x";
      display = `deno.land/x/${imp.name}`;
      break;
    case "raw-url":
      throw new Error(
        `cannot quarantine-check raw URL specifier: ${imp.url}`,
      );
    default:
      assertNever(imp);
  }
  const publishedAt = Date.parse(v.createdAt);
  const ageHours = (now.getTime() - publishedAt) / 3_600_000;
  return {
    kind,
    package: display,
    latestVersion: v.version,
    publishedAt: v.createdAt,
    ageHours,
    inQuarantine: ageHours < quarantineHours,
  };
}

export interface CheckAllResult {
  blocked: QuarantineResult[];
  cleared: QuarantineResult[];
  skipped: ExternalImport[];
  unsupported: UnsupportedImport[];
}

/**
 * Run the quarantine check across every external import in a `deno.json`
 * map. Raw `http(s)://` URL specifiers fail-closed into `unsupported`;
 * callers must treat a non-empty `unsupported` set as a blocking error.
 */
export async function checkAll(
  imports: Record<string, string>,
  fetcher: Fetcher,
  now: Date,
  quarantineHours: number,
): Promise<CheckAllResult> {
  const blocked: QuarantineResult[] = [];
  const cleared: QuarantineResult[] = [];
  const skipped: ExternalImport[] = [];
  const unsupported: UnsupportedImport[] = [];
  for (const imp of parseImports(imports)) {
    if (imp.kind === "raw-url") {
      unsupported.push({
        import: imp,
        reason:
          `raw URL specifier cannot be age-checked; refusing to update (${imp.url})`,
      });
      continue;
    }
    if (isInternalImport(imp)) {
      skipped.push(imp);
      continue;
    }
    const r = await checkImportQuarantine(imp, fetcher, now, quarantineHours);
    if (r.inQuarantine) blocked.push(r);
    else cleared.push(r);
  }
  return { blocked, cleared, skipped, unsupported };
}

/* ------------------------------------------------------------------ *
 * Resolved-lockfile mode (#616)
 *
 * The `checkAll` pipeline above answers "is the newest published version
 * of each direct import old enough to adopt?" — the question the weekly
 * bump asks before it runs `deno outdated --update`. A pull request asks
 * a different question: "is every version this branch actually resolves
 * old enough to trust?" That covers transitive packages, which never
 * appear in `deno.json`, and it stays stable on unrelated PRs because a
 * pinned version only ever gets older.
 * ------------------------------------------------------------------ */

/** A package version actually resolved in `deno.lock`. */
export interface ResolvedPackage {
  import: ExternalImport;
  version: string;
}

export interface LockfileParse {
  resolved: ResolvedPackage[];
  unsupported: UnsupportedImport[];
}

/** The subset of the `deno.lock` shape this gate reads. */
export interface Lockfile {
  jsr?: Record<string, unknown>;
  npm?: Record<string, unknown>;
  /** Lockfile v3/v4 nested the registry sections under `packages`. */
  packages?: {
    jsr?: Record<string, unknown>;
    npm?: Record<string, unknown>;
  };
  remote?: Record<string, unknown>;
}

/** Map of version string -> ISO 8601 publication timestamp. */
export type PublishTimes = Map<string, string>;

/**
 * Split a `deno.lock` registry key (`@scope/name@1.2.3`, `left-pad@1.3.0`)
 * into the package it names and the exact version it pins.
 *
 * npm keys carry peer-dependency suffixes after an underscore
 * (`@jimp/core@1.6.1_jimp@1.6.1`); only the part before the first `_`
 * identifies the package. Returns `null` for a key that cannot be parsed,
 * so the caller can fail closed rather than skip it silently.
 */
export function parseLockEntry(
  kind: "jsr" | "npm",
  key: string,
): ResolvedPackage | null {
  const base = kind === "npm" ? key.split("_")[0] : key;
  const at = base.lastIndexOf("@");
  if (at <= 0) return null;
  const name = base.slice(0, at);
  const version = base.slice(at + 1);
  if (!/^\d/.test(version)) return null;
  if (kind === "jsr") {
    const m = /^@([^/@]+)\/([^/@]+)$/.exec(name);
    if (!m) return null;
    return { import: { kind: "jsr", scope: m[1], name: m[2] }, version };
  }
  if (!/^(@[^/@]+\/)?[^/@]+$/.test(name)) return null;
  return { import: { kind: "npm", name }, version };
}

/**
 * Extract every distinct `package@version` pair the lockfile resolves,
 * across the JSR and npm sections (direct *and* transitive).
 *
 * Anything that cannot be age-checked — an unparseable registry key, or a
 * `remote:` raw-URL entry — is returned as `unsupported`; callers must
 * treat a non-empty `unsupported` set as blocking.
 */
export function parseLockfile(lock: Lockfile): LockfileParse {
  const seen = new Map<string, ResolvedPackage>();
  const unsupported: UnsupportedImport[] = [];
  const sections: Array<["jsr" | "npm", Record<string, unknown> | undefined]> =
    [
      ["jsr", lock.jsr ?? lock.packages?.jsr],
      ["npm", lock.npm ?? lock.packages?.npm],
    ];
  for (const [kind, section] of sections) {
    for (const key of Object.keys(section ?? {})) {
      const entry = parseLockEntry(kind, key);
      if (!entry) {
        unsupported.push({
          import: { kind: "raw-url", url: `${kind}:${key}` },
          reason:
            `unparseable ${kind} lockfile entry '${key}'; refusing to trust it`,
        });
        continue;
      }
      const dedup = `${importDisplayName(entry.import)}@${entry.version}`;
      if (!seen.has(dedup)) seen.set(dedup, entry);
    }
  }
  for (const url of Object.keys(lock.remote ?? {})) {
    unsupported.push({
      import: { kind: "raw-url", url },
      reason: `raw URL dependency in deno.lock cannot be age-checked (${url})`,
    });
  }
  return { resolved: [...seen.values()], unsupported };
}

/**
 * Every deno.json import that the lockfile does not resolve, reported as
 * unsupported so a PR cannot add a dependency to `deno.json` and dodge the
 * gate by leaving `deno.lock` stale.
 */
export function checkLockCoverage(
  imports: Record<string, string>,
  resolved: ResolvedPackage[],
): UnsupportedImport[] {
  const have = new Set(resolved.map((r) => importDisplayName(r.import)));
  const out: UnsupportedImport[] = [];
  for (const imp of parseImports(imports)) {
    if (imp.kind === "raw-url") {
      out.push({
        import: imp,
        reason:
          `raw URL specifier cannot be age-checked; refusing to trust it (${imp.url})`,
      });
      continue;
    }
    if (imp.kind === "denoland-x") {
      out.push({
        import: imp,
        reason:
          "deno.land/x specifier resolves to no pinned deno.lock entry; " +
          "its adopted version cannot be age-checked",
      });
      continue;
    }
    if (isInternalImport(imp)) continue;
    if (!have.has(importDisplayName(imp))) {
      out.push({
        import: imp,
        reason:
          "declared in deno.json but absent from deno.lock; regenerate the " +
          "lockfile so the adopted version can be age-checked",
      });
    }
  }
  return out;
}

/**
 * Load every published version of a package and its publication time, from
 * the registry that owns it.
 */
export async function fetchPublishTimes(
  imp: ExternalImport,
  fetcher: Fetcher,
): Promise<PublishTimes> {
  const times: PublishTimes = new Map();
  if (imp.kind === "jsr") {
    const url =
      `https://api.jsr.io/scopes/${imp.scope}/packages/${imp.name}/versions`;
    const res = await fetcher(url);
    if (!res.ok) {
      throw new Error(
        `JSR registry returned ${res.status} for @${imp.scope}/${imp.name}`,
      );
    }
    const data = await res.json() as
      | { items?: VersionRecord[] }
      | VersionRecord[];
    const items = Array.isArray(data) ? data : (data.items ?? []);
    for (const v of items) {
      if (v?.version && v.createdAt) times.set(v.version, v.createdAt);
    }
    return times;
  }
  if (imp.kind === "npm") {
    const res = await fetcher(`https://registry.npmjs.org/${imp.name}`);
    if (!res.ok) {
      throw new Error(`npm registry returned ${res.status} for ${imp.name}`);
    }
    const data = await res.json() as { time?: Record<string, string> };
    for (const [version, createdAt] of Object.entries(data.time ?? {})) {
      if (version === "created" || version === "modified") continue;
      times.set(version, createdAt);
    }
    return times;
  }
  throw new Error(
    `cannot age-check a resolved version for ${importDisplayName(imp)}`,
  );
}

/**
 * Age-check one resolved `package@version` against the quarantine window.
 *
 * `publishTimes` is the registry's version -> publication-time map; the
 * lookup fails loudly when the registry does not know the pinned version,
 * rather than treating an unknown version as aged.
 */
export function checkResolvedQuarantine(
  pkg: ResolvedPackage,
  publishTimes: PublishTimes,
  now: Date,
  quarantineHours: number,
): QuarantineResult {
  const display = importDisplayName(pkg.import);
  const createdAt = publishTimes.get(pkg.version);
  if (!createdAt) {
    throw new Error(
      `registry has no publication time for ${display}@${pkg.version}`,
    );
  }
  const ageHours = (now.getTime() - Date.parse(createdAt)) / 3_600_000;
  return {
    kind: pkg.import.kind === "jsr" ? "jsr" : "npm",
    package: display,
    latestVersion: pkg.version,
    publishedAt: createdAt,
    ageHours,
    inQuarantine: ageHours < quarantineHours,
  };
}

/**
 * Run the quarantine check across every version `deno.lock` resolves —
 * direct and transitive — and, when `imports` is supplied, confirm the
 * lockfile actually covers every external import `deno.json` declares.
 *
 * Registry responses are fetched once per package, so a package pinned at
 * several versions costs one request, not one per version.
 */
export async function checkLockfile(
  lock: Lockfile,
  fetcher: Fetcher,
  now: Date,
  quarantineHours: number,
  imports?: Record<string, string>,
): Promise<CheckAllResult> {
  const blocked: QuarantineResult[] = [];
  const cleared: QuarantineResult[] = [];
  const skipped: ExternalImport[] = [];
  const { resolved, unsupported } = parseLockfile(lock);
  if (imports) unsupported.push(...checkLockCoverage(imports, resolved));
  const cache = new Map<string, PublishTimes>();
  for (const pkg of resolved) {
    if (isInternalImport(pkg.import)) {
      skipped.push(pkg.import);
      continue;
    }
    const key = importDisplayName(pkg.import);
    let times = cache.get(key);
    if (!times) {
      times = await fetchPublishTimes(pkg.import, fetcher);
      cache.set(key, times);
    }
    const r = checkResolvedQuarantine(pkg, times, now, quarantineHours);
    if (r.inQuarantine) blocked.push(r);
    else cleared.push(r);
  }
  return { blocked, cleared, skipped, unsupported };
}

function parseQuarantineHours(raw: string | undefined): number {
  if (raw === undefined || raw === "") return 24;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Invalid VIBE_BUMP_QUARANTINE_HOURS '${raw}'`);
  }
  return n;
}

function describeSkipped(imp: ExternalImport): string {
  switch (imp.kind) {
    case "jsr":
      return `skip @${imp.scope}/${imp.name} (internal stSoftwareAU scope)`;
    case "npm":
      return `skip npm:${imp.name} (internal @stsoftwareau scope)`;
    case "denoland-x":
      return `skip deno.land/x/${imp.name}`;
    case "raw-url":
      return `skip ${imp.url}`;
    default:
      return assertNever(imp);
  }
}

/** Command-line arguments for the gate. */
export interface CliArgs {
  denoJsonPath: string;
  /** Non-null when the gate runs in resolved-lockfile mode (#616). */
  lockPath: string | null;
}

/**
 * Parse the gate's argv. `--lock [path]` selects resolved-lockfile mode
 * (defaulting to `deno.lock`); the single positional argument is the
 * manifest path (defaulting to `deno.json`). An unknown option is an error
 * rather than a silently ignored flag — a typo must not quietly disable
 * the gate's lockfile coverage.
 */
export function parseCliArgs(argv: string[]): CliArgs {
  let denoJsonPath: string | null = null;
  let lockPath: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--lock") {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        lockPath = next;
        i++;
      } else {
        lockPath = "deno.lock";
      }
      continue;
    }
    if (arg.startsWith("--lock=")) {
      lockPath = arg.slice("--lock=".length) || "deno.lock";
      continue;
    }
    if (arg.startsWith("-")) throw new Error(`Unknown option '${arg}'`);
    if (denoJsonPath !== null) {
      throw new Error(`Unexpected extra argument '${arg}'`);
    }
    denoJsonPath = arg;
  }
  return { denoJsonPath: denoJsonPath ?? "deno.json", lockPath };
}

if (import.meta.main) {
  let args: CliArgs;
  let quarantineHours: number;
  try {
    args = parseCliArgs(Deno.args);
    quarantineHours = parseQuarantineHours(
      Deno.env.get("VIBE_BUMP_QUARANTINE_HOURS"),
    );
  } catch (e) {
    console.error((e as Error).message);
    Deno.exit(2);
  }

  const text = await Deno.readTextFile(args.denoJsonPath);
  const config = JSON.parse(text) as { imports?: Record<string, string> };
  const imports = config.imports ?? {};
  const fetcher: Fetcher = (url) => fetch(url);
  const mode = args.lockPath === null ? "latest published" : "resolved";

  let result: CheckAllResult;
  try {
    if (args.lockPath === null) {
      result = await checkAll(imports, fetcher, new Date(), quarantineHours);
    } else {
      const lock = JSON.parse(
        await Deno.readTextFile(args.lockPath),
      ) as Lockfile;
      result = await checkLockfile(
        lock,
        fetcher,
        new Date(),
        quarantineHours,
        imports,
      );
    }
  } catch (e) {
    // Fail loud: a registry lookup that could not complete leaves a version
    // unverified, which must never be reported as a clean gate.
    console.error(`\nQuarantine gate: ${(e as Error).message}. Aborting.`);
    Deno.exit(1);
  }
  const { blocked, cleared, skipped, unsupported } = result;

  for (const imp of skipped) {
    console.log(describeSkipped(imp));
  }
  for (const r of cleared) {
    console.log(
      `ok   ${r.package}@${r.latestVersion} aged ${
        r.ageHours.toFixed(1)
      }h (>= ${quarantineHours}h)`,
    );
  }
  for (const r of blocked) {
    console.log(
      `HOLD ${r.package}@${r.latestVersion} aged ${
        r.ageHours.toFixed(1)
      }h (< ${quarantineHours}h) published ${r.publishedAt}`,
    );
  }
  for (const u of unsupported) {
    console.log(`FAIL ${importDisplayName(u.import)}: ${u.reason}`);
  }

  if (unsupported.length > 0) {
    console.error(
      `\nQuarantine gate: ${unsupported.length} unsupported specifier(s) cannot be age-checked. Aborting.`,
    );
    Deno.exit(1);
  }
  if (blocked.length > 0) {
    console.error(
      `\nQuarantine gate: ${blocked.length} package(s) under ${quarantineHours}h since publication. Aborting.`,
    );
    Deno.exit(1);
  }
  console.log(
    `\nQuarantine gate (${mode} versions): OK (${cleared.length} cleared, ${skipped.length} internal skipped).`,
  );
}
