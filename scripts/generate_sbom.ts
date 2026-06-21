/**
 * Deno-native CycloneDX SBOM generator (#358).
 *
 * Reads the resolved dependency closure from `deno.lock` and emits a
 * CycloneDX 1.5 Software Bill of Materials describing every JSR and npm
 * package that ships with the deployed PWA. The lockfile is the single
 * source of truth: every entry under its `jsr` and `npm` sections becomes
 * one SBOM component, carrying the package coordinates (name, version,
 * purl) and the integrity hash Deno already pinned.
 *
 * No Node tooling is involved — this is pure Deno, consistent with the
 * rest of the repo's supply-chain scripts (cf. jsr_quarantine_check.ts).
 *
 * Usage:
 *   deno run --allow-read --allow-write scripts/generate_sbom.ts \
 *     [deno.lock] [sbom.cdx.json]
 *
 * With no output path the SBOM is written to stdout.
 */

/** A single SBOM component derived from a lockfile entry. */
export interface SbomComponent {
  type: "library";
  "bom-ref": string;
  name: string;
  version: string;
  purl: string;
  ecosystem: "jsr" | "npm";
  hashes?: Array<{ alg: string; content: string }>;
}

/** Minimal shape of the parts of `deno.lock` we consume. */
export interface DenoLock {
  version?: string;
  jsr?: Record<string, { integrity?: string }>;
  npm?: Record<string, { integrity?: string }>;
}

/** Metadata describing the application the SBOM is produced for. */
export interface SbomAppMeta {
  name: string;
  version: string;
}

/**
 * Split a lockfile package key (`name@version`) into its name and version.
 * Handles scoped names whose own `@` prefix must not be mistaken for the
 * version separator, e.g. `@std/cli@1.0.29` → `{ name: "@std/cli",
 * version: "1.0.29" }`. Returns `null` when no version separator is found.
 */
export function splitNameVersion(
  key: string,
): { name: string; version: string } | null {
  const at = key.lastIndexOf("@");
  // `at <= 0` means either no `@` or only the leading scope `@`.
  if (at <= 0) return null;
  const name = key.slice(0, at);
  const version = key.slice(at + 1);
  if (name === "" || version === "") return null;
  return { name, version };
}

/**
 * Build the Package URL for an npm component. Scoped names percent-encode
 * the leading `@` of the scope per the purl spec, e.g.
 * `@jimp/core` → `pkg:npm/%40jimp/core@1.6.1`.
 */
export function npmPurl(name: string, version: string): string {
  if (name.startsWith("@")) {
    const slash = name.indexOf("/");
    const scope = name.slice(0, slash); // includes leading '@'
    const rest = name.slice(slash + 1);
    return `pkg:npm/${encodeURIComponent(scope)}/${rest}@${version}`;
  }
  return `pkg:npm/${name}@${version}`;
}

/**
 * Build the Package URL for a JSR component. JSR names are always scoped
 * (`@scope/name`), e.g. `@std/cli` → `pkg:jsr/%40std/cli@1.0.29`.
 */
export function jsrPurl(name: string, version: string): string {
  if (name.startsWith("@")) {
    const slash = name.indexOf("/");
    const scope = name.slice(0, slash);
    const rest = name.slice(slash + 1);
    return `pkg:jsr/${encodeURIComponent(scope)}/${rest}@${version}`;
  }
  return `pkg:jsr/${name}@${version}`;
}

/** Lowercase hex test — matches a bare SHA-256 hex digest. */
const HEX_SHA256 = /^[0-9a-f]{64}$/i;

/** Decode a base64 string to a lowercase hex string. */
function base64ToHex(b64: string): string {
  const bin = atob(b64);
  let hex = "";
  for (let i = 0; i < bin.length; i++) {
    hex += bin.charCodeAt(i).toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Convert a Deno lockfile integrity string into a CycloneDX hash entry.
 *
 * - npm integrities are Subresource-Integrity strings (`sha512-<base64>`),
 *   converted to the hex content CycloneDX expects.
 * - JSR integrities are bare lowercase SHA-256 hex digests.
 *
 * Returns `null` for empty or unrecognised integrity strings rather than
 * emitting a malformed hash.
 */
export function integrityToHash(
  integrity: string | undefined,
): { alg: string; content: string } | null {
  if (!integrity) return null;
  const dash = integrity.indexOf("-");
  if (dash > 0) {
    const algRaw = integrity.slice(0, dash).toLowerCase();
    const payload = integrity.slice(dash + 1);
    const alg = algRaw === "sha512"
      ? "SHA-512"
      : algRaw === "sha384"
      ? "SHA-384"
      : algRaw === "sha256"
      ? "SHA-256"
      : null;
    if (!alg || payload === "") return null;
    try {
      return { alg, content: base64ToHex(payload) };
    } catch {
      return null;
    }
  }
  if (HEX_SHA256.test(integrity)) {
    return { alg: "SHA-256", content: integrity.toLowerCase() };
  }
  return null;
}

/** Build SBOM components from one lockfile ecosystem section. */
function componentsFromSection(
  section: Record<string, { integrity?: string }> | undefined,
  ecosystem: "jsr" | "npm",
): SbomComponent[] {
  const out: SbomComponent[] = [];
  for (const [key, entry] of Object.entries(section ?? {})) {
    const nv = splitNameVersion(key);
    if (!nv) continue;
    const purl = ecosystem === "jsr"
      ? jsrPurl(nv.name, nv.version)
      : npmPurl(nv.name, nv.version);
    const component: SbomComponent = {
      type: "library",
      "bom-ref": purl,
      name: nv.name,
      version: nv.version,
      purl,
      ecosystem,
    };
    const hash = integrityToHash(entry?.integrity);
    if (hash) component.hashes = [hash];
    out.push(component);
  }
  return out;
}

/**
 * Extract every JSR and npm component from a parsed `deno.lock`, sorted by
 * ecosystem then purl for deterministic output.
 */
export function lockToComponents(lock: DenoLock): SbomComponent[] {
  const components = [
    ...componentsFromSection(lock.jsr, "jsr"),
    ...componentsFromSection(lock.npm, "npm"),
  ];
  components.sort((a, b) =>
    a.ecosystem === b.ecosystem
      ? a.purl.localeCompare(b.purl)
      : a.ecosystem.localeCompare(b.ecosystem)
  );
  return components;
}

/** The full CycloneDX document shape we emit. */
export interface CycloneDxBom {
  bomFormat: "CycloneDX";
  specVersion: "1.5";
  serialNumber?: string;
  version: number;
  metadata: {
    timestamp?: string;
    tools: Array<{ vendor: string; name: string }>;
    component: {
      type: "application";
      "bom-ref": string;
      name: string;
      version: string;
    };
  };
  components: Array<
    Omit<SbomComponent, "ecosystem"> & {
      properties: Array<{ name: string; value: string }>;
    }
  >;
}

export interface BuildSbomOptions {
  timestamp?: string;
  serialNumber?: string;
}

/** Assemble a complete CycloneDX 1.5 BOM from a parsed lockfile. */
export function buildSbom(
  lock: DenoLock,
  app: SbomAppMeta,
  opts: BuildSbomOptions = {},
): CycloneDxBom {
  const components = lockToComponents(lock).map(({ ecosystem, ...c }) => ({
    ...c,
    properties: [{ name: "deno:ecosystem", value: ecosystem }],
  }));
  const bom: CycloneDxBom = {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    version: 1,
    metadata: {
      tools: [{ vendor: "NEAT-AI-Explore", name: "generate_sbom.ts" }],
      component: {
        type: "application",
        "bom-ref": `${app.name}@${app.version}`,
        name: app.name,
        version: app.version,
      },
    },
    components,
  };
  if (opts.timestamp) bom.metadata.timestamp = opts.timestamp;
  if (opts.serialNumber) bom.serialNumber = opts.serialNumber;
  return bom;
}

/** Read application name/version from `version.json` (falls back gracefully). */
async function readAppMeta(): Promise<SbomAppMeta> {
  let version = "0.0.0";
  try {
    const raw = await Deno.readTextFile("version.json");
    const parsed = JSON.parse(raw) as { version?: string };
    if (typeof parsed.version === "string") version = parsed.version;
  } catch {
    // version.json optional — keep the fallback.
  }
  return { name: "neat-ai-explore", version };
}

if (import.meta.main) {
  const lockPath = Deno.args[0] ?? "deno.lock";
  const outPath = Deno.args[1];
  const lockText = await Deno.readTextFile(lockPath);
  const lock = JSON.parse(lockText) as DenoLock;
  const app = await readAppMeta();
  const bom = buildSbom(lock, app, {
    timestamp: new Date().toISOString(),
    serialNumber: `urn:uuid:${crypto.randomUUID()}`,
  });
  const json = JSON.stringify(bom, null, 2);
  if (outPath) {
    await Deno.writeTextFile(outPath, json + "\n");
    console.log(
      `Wrote ${bom.components.length} components to ${outPath}`,
    );
  } else {
    console.log(json);
  }
}
