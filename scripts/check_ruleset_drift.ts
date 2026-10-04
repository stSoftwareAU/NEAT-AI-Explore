/**
 * Ruleset drift check (#658).
 *
 * `.github/rulesets/*.json` mirror the repository's live rulesets so branch
 * protection can be reviewed in a PR. Nothing kept them in step: the Develop
 * mirror listed `quality` and `dependency-quarantine` while live required
 * eight other contexts, and a PR trusted the stale file. This script fetches
 * the live rulesets and reports every difference, pairing rulesets by name.
 *
 * API metadata (`id`, timestamps, `_links`, ...) and the mirror's `_comment`
 * are ignored, as is array order. `bypass_actors` is compared only when the
 * API returns it, which it does for admin tokens alone.
 *
 * Usage:
 *   GITHUB_TOKEN=... deno run --allow-read=.github/rulesets \
 *     --allow-net=api.github.com --allow-env=GITHUB_TOKEN \
 *     scripts/check_ruleset_drift.ts --repo owner/name [--dir .github/rulesets]
 */

export interface Ruleset {
  name?: string;
  id?: number;
  source_type?: string;
  rules?: unknown[];
  [key: string]: unknown;
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** Fields the API adds that a checked-in mirror never carries. */
const IGNORED_FIELDS = [
  "_comment",
  "id",
  "source_type",
  "source",
  "node_id",
  "created_at",
  "updated_at",
  "current_user_can_bypass",
  "_links",
];

const REPO_SLUG = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const PAGE_SIZE = 100;

type Json = unknown;

function isObject(v: Json): v is Record<string, Json> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** JSON with object keys sorted, so equal values compare equal. */
function canonical(v: Json): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (isObject(v)) {
    const keys = Object.keys(v).sort();
    return `{${
      keys.map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")
    }}`;
  }
  return JSON.stringify(v);
}

/**
 * Key array elements so order is irrelevant: by `type` (rules) or `context`
 * (status checks) when that field is a unique string, else by value.
 */
function keyElements(arr: Json[]): Map<string, Json> | null {
  for (const field of ["type", "context"]) {
    const keys = arr.map((e) => isObject(e) ? e[field] : undefined);
    if (
      keys.every((k) => typeof k === "string") &&
      new Set(keys).size === keys.length
    ) {
      return new Map(arr.map((e, i) => [keys[i] as string, e]));
    }
  }
  return null;
}

function diff(file: Json, live: Json, path: string, out: string[]): void {
  if (Array.isArray(file) && Array.isArray(live)) {
    const a = keyElements(file);
    const b = keyElements(live);
    if (a && b) {
      for (const [k, v] of a) {
        if (b.has(k)) diff(v, b.get(k), `${path}[${k}]`, out);
        else out.push(`${path}[${k}]: only in checked-in file`);
      }
      for (const k of b.keys()) {
        if (!a.has(k)) out.push(`${path}[${k}]: only in live`);
      }
      return;
    }
    const fa = new Set(file.map(canonical));
    const fb = new Set(live.map(canonical));
    for (const v of fa) {
      if (!fb.has(v)) out.push(`${path}: ${v} only in checked-in file`);
    }
    for (const v of fb) {
      if (!fa.has(v)) out.push(`${path}: ${v} only in live`);
    }
    return;
  }
  if (isObject(file) && isObject(live)) {
    const keys = [...new Set([...Object.keys(file), ...Object.keys(live)])]
      .sort();
    for (const k of keys) {
      const p = path ? `${path}.${k}` : k;
      if (!(k in live)) out.push(`${p}: only in checked-in file`);
      else if (!(k in file)) out.push(`${p}: only in live`);
      else diff(file[k], live[k], p, out);
    }
    return;
  }
  if (canonical(file) !== canonical(live)) {
    out.push(
      `${path}: checked-in file has ${canonical(file)}, live has ${
        canonical(live)
      }`,
    );
  }
}

function strip(r: Ruleset): Ruleset {
  const copy: Ruleset = { ...r };
  for (const k of IGNORED_FIELDS) delete copy[k];
  return copy;
}

/** Every difference between a checked-in ruleset and its live twin. */
export function compareRuleset(file: Ruleset, live: Ruleset): string[] {
  const a = strip(file);
  const b = strip(live);
  // Only admins see bypass_actors; an absent field is unknown, not empty.
  if (!("bypass_actors" in b)) delete a.bypass_actors;
  const out: string[] = [];
  diff(a, b, "", out);
  return out;
}

/** Pair checked-in files with live rulesets by name and compare each. */
export function compareRulesetSets(
  files: Map<string, Ruleset>,
  live: Ruleset[],
): string[] {
  const problems: string[] = [];
  const claimed = new Map<string, string>();
  for (const [file, ruleset] of files) {
    const name = ruleset.name;
    if (typeof name !== "string" || name === "") {
      problems.push(`${file}: missing a "name"`);
      continue;
    }
    const first = claimed.get(name);
    if (first) {
      problems.push(`${file}: duplicate of ${first} (both name "${name}")`);
      continue;
    }
    claimed.set(name, file);
    const twin = live.find((r) => r.name === name);
    if (!twin) {
      problems.push(`${file}: no live ruleset named "${name}"`);
      continue;
    }
    for (const p of compareRuleset(ruleset, twin)) {
      problems.push(`${file}: ${p}`);
    }
  }
  for (const r of live) {
    // Organisation rulesets are inherited, not owned by this repo's mirror.
    const own = r.source_type === undefined || r.source_type === "Repository";
    if (own && !claimed.has(String(r.name))) {
      problems.push(`live ruleset "${r.name}" has no checked-in file`);
    }
  }
  return problems;
}

async function getJson(
  url: string,
  token: string | undefined,
  fetcher: Fetcher,
): Promise<Json> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetcher(url, { headers });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 200);
    throw new Error(`GET ${url} failed: HTTP ${res.status} ${body}`);
  }
  return await res.json();
}

/** Fetch every live ruleset (full detail) for `repo`. */
export async function fetchLiveRulesets(
  repo: string,
  token: string | undefined,
  fetcher: Fetcher = fetch,
): Promise<Ruleset[]> {
  if (!REPO_SLUG.test(repo) || repo.includes("..")) {
    throw new Error(`--repo must be owner/name, got: ${repo}`);
  }
  const base = `https://api.github.com/repos/${repo}/rulesets`;
  const list = await getJson(`${base}?per_page=${PAGE_SIZE}`, token, fetcher);
  if (!Array.isArray(list)) {
    throw new Error(`GET ${base}: expected an array of rulesets`);
  }
  if (list.length >= PAGE_SIZE) {
    // SIMPLE-ON-PURPOSE: one page of 100 rulesets — upgrade when a repo nears 100.
    throw new Error(`${repo} has ${PAGE_SIZE}+ rulesets; add pagination`);
  }
  const out: Ruleset[] = [];
  for (const entry of list) {
    const id = isObject(entry) ? entry.id : undefined;
    if (typeof id !== "number") {
      throw new Error(`GET ${base}: ruleset entry without a numeric id`);
    }
    const full = await getJson(`${base}/${id}`, token, fetcher);
    if (!isObject(full)) throw new Error(`GET ${base}/${id}: not an object`);
    out.push(full as Ruleset);
  }
  return out;
}

/** Every `*.json` ruleset mirror in `dir`, keyed by file name. */
export async function loadCheckedInRulesets(
  dir: string | URL,
): Promise<Map<string, Ruleset>> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (entry.isFile && entry.name.endsWith(".json")) names.push(entry.name);
  }
  names.sort();
  const base = typeof dir === "string"
    ? dir.replace(/\/?$/, "/")
    : dir.href.replace(/\/?$/, "/");
  const out = new Map<string, Ruleset>();
  for (const name of names) {
    const path = typeof dir === "string" ? base + name : new URL(name, base);
    let parsed: Json;
    try {
      parsed = JSON.parse(await Deno.readTextFile(path));
    } catch (e) {
      throw new Error(`${name}: not valid JSON (${(e as Error).message})`);
    }
    if (!isObject(parsed)) throw new Error(`${name}: not a JSON object`);
    out.set(name, parsed as Ruleset);
  }
  return out;
}

export interface CliArgs {
  repo: string;
  dir: string;
}

export function parseCliArgs(args: string[]): CliArgs {
  let repo: string | undefined;
  let dir = ".github/rulesets";
  for (let i = 0; i < args.length; i++) {
    const value = args[i + 1];
    if (args[i] === "--repo" && value) repo = value;
    else if (args[i] === "--dir" && value) dir = value;
    else throw new Error(`unexpected argument: ${args[i]}`);
    i++;
  }
  if (!repo) throw new Error("usage: --repo owner/name [--dir path]");
  return { repo, dir };
}

if (import.meta.main) {
  try {
    const args = parseCliArgs(Deno.args);
    const files = await loadCheckedInRulesets(args.dir);
    const live = await fetchLiveRulesets(
      args.repo,
      Deno.env.get("GITHUB_TOKEN") || undefined,
    );
    const problems = compareRulesetSets(files, live);
    if (problems.length > 0) {
      console.error(
        `Ruleset drift: ${args.dir} does not match ${args.repo} (#658):`,
      );
      for (const p of problems) console.error(`  - ${p}`);
      console.error(
        "Update the mirror to match live, or ask an admin to change live.",
      );
      Deno.exit(1);
    }
    console.log(`${files.size} rulesets in sync with ${args.repo}`);
  } catch (e) {
    console.error(`Ruleset drift check failed: ${(e as Error).message}`);
    Deno.exit(1);
  }
}
