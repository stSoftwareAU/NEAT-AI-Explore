/**
 * Refuse `version.json` downgrades relative to the PR base branch (#605).
 *
 * Why:
 * - `.github/workflows/semver-bump.yml` auto-patch-bumps a PR whose version
 *   equals the base, and skips when it differs. A merge conflict that takes
 *   Develop's *older* `version.json` therefore looked like a deliberate bump
 *   and shipped a downgrade unnoticed.
 * - Sibling rebuilds key off the published version, so a version that goes
 *   backwards is a silent, downstream-visible fault.
 *
 * Behaviour:
 * - head version behind the base ref  -> exit 1 (loud CI failure)
 * - head version equal to the base    -> exit 0 (the workflow may auto-bump)
 * - head version ahead of the base    -> exit 0 (accepted, no further bump)
 * - version unreadable / unparseable  -> exit 2 (never silently pass)
 *
 * Usage (from the repository root):
 *   deno run --allow-read --allow-run=git \
 *     scripts/check_version_no_downgrade.ts [--base-ref origin/Develop] \
 *     [--file version.json]
 */

/** A head-versus-base ordering. */
export type VersionChange = "behind" | "equal" | "ahead";

/** Outcome of comparing a head version against its base. */
export interface VersionCheck {
  ok: boolean;
  classification: VersionChange;
  message: string;
}

const DEFAULT_BASE_REF = "origin/Develop";
const DEFAULT_FILE = "version.json";

/** Parse a plain `MAJOR.MINOR.PATCH` token into numeric parts. */
export function parsePackageSemver(
  version: string,
): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * Compare two plain semver tokens numerically.
 *
 * @returns negative when `a < b`, zero when equal, positive when `a > b`
 * @throws when either token is not a plain `MAJOR.MINOR.PATCH` string
 */
export function comparePackageSemver(a: string, b: string): number {
  const pa = parsePackageSemver(a);
  const pb = parsePackageSemver(b);
  if (pa === null) throw new Error(`invalid package semver: ${a}`);
  if (pb === null) throw new Error(`invalid package semver: ${b}`);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

/** Classify `current` relative to `base`. */
export function classifyVersionChange(
  current: string,
  base: string,
): VersionChange {
  const order = comparePackageSemver(current, base);
  if (order < 0) return "behind";
  if (order > 0) return "ahead";
  return "equal";
}

/** Compare a head version against its base, with a reviewer-readable message. */
export function checkVersionNoDowngrade(
  current: string,
  base: string,
): VersionCheck {
  const classification = classifyVersionChange(current, base);
  if (classification === "behind") {
    return {
      ok: false,
      classification,
      message:
        `version.json ${current} is behind the base version ${base}; package ` +
        `versions must never go backwards. Bump past the base (this usually ` +
        `means a merge conflict took the base branch's older version.json).`,
    };
  }
  return {
    ok: true,
    classification,
    message: classification === "equal"
      ? `version.json ${current} matches the base version; a patch bump may be applied.`
      : `version.json ${current} is ahead of the base version ${base}.`,
  };
}

/** Extract the `version` string from `version.json` text, or null. */
export function readVersionFromJson(text: string): string | null {
  try {
    const json = JSON.parse(text) as { version?: unknown };
    return typeof json.version === "string" ? json.version : null;
  } catch {
    return null;
  }
}

/** Read `<ref>:<file>` via git, or null when the ref or path is unavailable. */
function readVersionAtRef(
  ref: string,
  file: string,
  cwd: string,
): string | null {
  try {
    const out = new Deno.Command("git", {
      args: ["show", `${ref}:${file}`],
      cwd,
      stdout: "piped",
      stderr: "piped",
    }).outputSync();
    if (!out.success) return null;
    return readVersionFromJson(new TextDecoder().decode(out.stdout));
  } catch {
    return null;
  }
}

interface Options {
  baseRef: string;
  file: string;
}

function parseArgs(args: string[]): Options | null {
  const options: Options = { baseRef: DEFAULT_BASE_REF, file: DEFAULT_FILE };
  for (let i = 0; i < args.length; i++) {
    const value = args[i + 1];
    if (args[i] === "--base-ref" && value) {
      options.baseRef = value;
      i++;
    } else if (args[i] === "--file" && value) {
      options.file = value;
      i++;
    } else {
      return null;
    }
  }
  return options;
}

/**
 * Run the guard.
 *
 * @param args CLI arguments (`--base-ref`, `--file`)
 * @param cwd repository root to inspect
 * @returns the process exit code: 0 pass, 1 downgrade, 2 could not evaluate
 */
export function main(args: string[], cwd = "."): number {
  const options = parseArgs(args);
  if (!options) {
    console.error(
      "Usage: check_version_no_downgrade.ts [--base-ref <ref>] [--file <path>]",
    );
    return 2;
  }

  let currentText: string;
  try {
    currentText = Deno.readTextFileSync(`${cwd}/${options.file}`);
  } catch (error) {
    console.error(`Cannot read ${options.file}: ${String(error)}`);
    return 2;
  }

  const current = readVersionFromJson(currentText);
  if (current === null) {
    console.error(`${options.file} has no string "version" field`);
    return 2;
  }

  const base = readVersionAtRef(options.baseRef, options.file, cwd);
  if (base === null) {
    console.error(
      `Cannot read ${options.file} at ${options.baseRef}; refusing to pass ` +
        `the downgrade guard without a base version to compare against.`,
    );
    return 2;
  }

  let result: VersionCheck;
  try {
    result = checkVersionNoDowngrade(current, base);
  } catch (error) {
    console.error(String(error));
    return 2;
  }

  if (!result.ok) {
    console.error(`::error::${result.message}`);
    return 1;
  }
  console.log(result.message);
  return 0;
}

if (import.meta.main) {
  Deno.exit(main(Deno.args));
}
