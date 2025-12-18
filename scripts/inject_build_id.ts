/**
 * Inject a build ID into the deployed docs/ app shell.
 *
 * Why:
 * - GitHub Pages + Service Worker caching can leave users on stale assets.
 * - We want cache busting to be automatic on every deploy, without needing to
 *   manually bump versions or tell users to clear cache.
 *
 * How:
 * - Source files contain the placeholder `__BUILD_ID__`.
 * - This script replaces it with a provided build ID (usually a short git SHA)
 *   in:
 *   - docs/index.html
 *   - docs/sw.js
 *
 * Usage (from repo root):
 *   deno run --allow-read --allow-write ./scripts/inject_build_id.ts <buildId>
 */

function usageAndExit(): never {
  console.error("Usage: inject_build_id.ts <buildId>");
  Deno.exit(2);
}

const buildId = (Deno.args[0] ?? "").trim();
if (!buildId) usageAndExit();

const files = [
  "./docs/index.html",
  "./docs/sw.js",
];

for (const path of files) {
  const before = await Deno.readTextFile(path);
  if (!before.includes("__BUILD_ID__")) {
    console.error(`Expected ${path} to contain __BUILD_ID__ placeholder`);
    Deno.exit(1);
  }
  const after = before.replaceAll("__BUILD_ID__", buildId);
  await Deno.writeTextFile(path, after);
}

console.log(`Injected build ID '${buildId}' into docs app shell`);
