/**
 * JSR dependency quarantine gate (#189).
 *
 * Read deno.json's `imports` map, identify every external JSR package, and
 * query the JSR registry for its most recently published, non-yanked version.
 * If any external package's latest version was published less than
 * VIBE_BUMP_QUARANTINE_HOURS (default 24) hours ago, exit non-zero so the
 * scheduled upgrade workflow halts before `deno outdated --update --latest`
 * can ingest a freshly-published (potentially malicious) version.
 *
 * Per house policy, `stSoftwareAU/*` is treated as internal and bypasses the
 * gate. All other scopes — including `@std/*` — are external.
 *
 * Usage:
 *   deno run --allow-read --allow-net=api.jsr.io \
 *     scripts/jsr_quarantine_check.ts [deno.json]
 */

export interface JsrPackage {
  scope: string;
  name: string;
}

export interface VersionRecord {
  version: string;
  yanked: boolean;
  createdAt: string;
}

export interface QuarantineResult {
  package: string;
  latestVersion: string;
  publishedAt: string;
  ageHours: number;
  inQuarantine: boolean;
}

export type Fetcher = (url: string) => Promise<Response>;

/** Match `jsr:@scope/name` at the start of an import specifier. */
const JSR_SPEC = /^jsr:@([^/]+)\/([^@/]+)/;

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

/** stSoftwareAU/* is internal per VIBE_BUMP_QUARANTINE_HOURS policy. */
export function isInternal(pkg: JsrPackage): boolean {
  return pkg.scope.toLowerCase() === "stsoftwareau";
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

/** Resolve whether a single package is currently inside the quarantine window. */
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
    package: `@${pkg.scope}/${pkg.name}`,
    latestVersion: v.version,
    publishedAt: v.createdAt,
    ageHours,
    inQuarantine: ageHours < quarantineHours,
  };
}

export interface CheckAllResult {
  blocked: QuarantineResult[];
  cleared: QuarantineResult[];
  skipped: JsrPackage[];
}

/** Run the quarantine check across every JSR import in a `deno.json` map. */
export async function checkAll(
  imports: Record<string, string>,
  fetcher: Fetcher,
  now: Date,
  quarantineHours: number,
): Promise<CheckAllResult> {
  const blocked: QuarantineResult[] = [];
  const cleared: QuarantineResult[] = [];
  const skipped: JsrPackage[] = [];
  for (const pkg of parseJsrImports(imports)) {
    if (isInternal(pkg)) {
      skipped.push(pkg);
      continue;
    }
    const r = await checkQuarantine(pkg, fetcher, now, quarantineHours);
    if (r.inQuarantine) blocked.push(r);
    else cleared.push(r);
  }
  return { blocked, cleared, skipped };
}

function parseQuarantineHours(raw: string | undefined): number {
  if (raw === undefined || raw === "") return 24;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Invalid VIBE_BUMP_QUARANTINE_HOURS '${raw}'`);
  }
  return n;
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
  const { blocked, cleared, skipped } = await checkAll(
    imports,
    fetcher,
    new Date(),
    quarantineHours,
  );

  for (const pkg of skipped) {
    console.log(`skip @${pkg.scope}/${pkg.name} (internal stSoftwareAU scope)`);
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
