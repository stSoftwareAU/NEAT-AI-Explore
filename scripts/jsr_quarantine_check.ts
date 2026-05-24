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
 * Usage:
 *   deno run --allow-read \
 *     --allow-net=api.jsr.io,registry.npmjs.org,cdn.deno.land,deno.land \
 *     scripts/jsr_quarantine_check.ts [deno.json]
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

/** Extract every distinct JSR package referenced by an `imports` map. */
export function parseJsrImports(
  imports: Record<string, string>,
): JsrPackage[] {
  const seen = new Map<string, JsrPackage>();
  for (const spec of Object.values(imports)) {
    const m = JSR_SPEC.exec(spec);
    if (!m) continue;
    const [, scope, name] = m;
    const key = `${scope}/${name}`;
    if (!seen.has(key)) seen.set(key, { scope, name });
  }
  return [...seen.values()];
}

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

/** Resolve whether a single JSR package is currently inside the window. */
export async function checkQuarantine(
  pkg: JsrPackage,
  fetcher: Fetcher,
  now: Date,
  quarantineHours: number,
): Promise<QuarantineResult> {
  const v = await fetchLatestVersion(pkg, fetcher);
  const publishedAt = Date.parse(v.createdAt);
  const ageHours = (now.getTime() - publishedAt) / 3_600_000;
  return {
    kind: "jsr",
    package: `@${pkg.scope}/${pkg.name}`,
    latestVersion: v.version,
    publishedAt: v.createdAt,
    ageHours,
    inQuarantine: ageHours < quarantineHours,
  };
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
  }
}

if (import.meta.main) {
  const denoJsonPath = Deno.args[0] ?? "deno.json";
  const text = await Deno.readTextFile(denoJsonPath);
  const config = JSON.parse(text) as { imports?: Record<string, string> };
  const imports = config.imports ?? {};

  let quarantineHours: number;
  try {
    quarantineHours = parseQuarantineHours(
      Deno.env.get("VIBE_BUMP_QUARANTINE_HOURS"),
    );
  } catch (e) {
    console.error((e as Error).message);
    Deno.exit(2);
  }

  const fetcher: Fetcher = (url) => fetch(url);
  const { blocked, cleared, skipped, unsupported } = await checkAll(
    imports,
    fetcher,
    new Date(),
    quarantineHours,
  );

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
      `\nQuarantine gate: ${unsupported.length} unsupported specifier(s) cannot be age-checked. Aborting upgrade.`,
    );
    Deno.exit(1);
  }
  if (blocked.length > 0) {
    console.error(
      `\nQuarantine gate: ${blocked.length} package(s) under ${quarantineHours}h since publication. Aborting upgrade.`,
    );
    Deno.exit(1);
  }
  console.log(
    `\nQuarantine gate: OK (${cleared.length} cleared, ${skipped.length} internal skipped).`,
  );
}
