/**
 * Local static server for NEAT-AI Explore.
 *
 * Uses Deno + JSR (Std) so we don't depend on Node tooling.
 *
 * Defaults:
 * - Port: 8000
 * - Directory: docs/ (matches the deployed GitHub Pages / PWA output)
 *
 * Usage:
 *   deno run --allow-net --allow-read --allow-env ./helpers/server.ts [port] [dir]
 *
 * Examples:
 *   deno run --allow-net --allow-read --allow-env ./helpers/server.ts
 *   deno run --allow-net --allow-read --allow-env ./helpers/server.ts 8000 docs
 *   deno run --allow-net --allow-read --allow-env ./helpers/server.ts 8000 .
 */

import { serveDir } from "@std/http/file-server";
import { fromFileUrl, join, normalize } from "@std/path";

function parsePort(raw: string | undefined): number {
  const n = Number(raw ?? "");
  if (!Number.isFinite(n)) return 8000;
  if (n <= 0 || n >= 65536) return 8000;
  return Math.floor(n);
}

function shouldSpaFallback(req: Request): boolean {
  // Only for browser navigations: if they accept HTML, they're probably loading the app.
  const accept = req.headers.get("accept") ?? "";
  return req.method === "GET" && accept.includes("text/html");
}

function resolveServeDir(repoRoot: string, dirArg: string | undefined): string {
  const dir = (dirArg ?? "docs").trim() || "docs";
  // Prevent accidental path traversal outside repo root.
  return normalize(join(repoRoot, dir));
}

const repoRoot = fromFileUrl(new URL("..", import.meta.url));
const port = parsePort(Deno.args[0]);
const fsRoot = resolveServeDir(
  repoRoot,
  Deno.args[1] ?? Deno.env.get("SERVE_DIR"),
);

console.log("Starting NEAT-AI Explore static server");
console.log(`Repo root: ${repoRoot}`);
console.log(`Serving:  ${fsRoot}`);
console.log(`URL:      http://localhost:${port}`);
console.log("Press Ctrl+C to stop");
console.log("");

Deno.serve(
  { port },
  async (req) => {
    // Try static first.
    const res = await serveDir(req, { fsRoot });
    if (res.status !== 404) return res;

    // Simple SPA fallback to index.html for navigations (handy when people paste links).
    if (shouldSpaFallback(req)) {
      const url = new URL(req.url);
      const indexUrl = new URL(url);
      indexUrl.pathname = "/index.html";
      return await serveDir(new Request(indexUrl, req), { fsRoot });
    }

    return res;
  },
);
