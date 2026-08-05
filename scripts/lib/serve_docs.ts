/**
 * Shared "serve the published docs/ folder on an ephemeral port" scaffold for
 * the Playwright verification scripts (Issue #599).
 *
 * Six `scripts/verify_*.ts` scripts each inlined the same free-port +
 * `serveDir` block, so any change to how the scripts stand up `docs/` had to
 * be repeated six times. They all call this module instead.
 */

import { serveDir } from "@std/http/file-server";
import { fromFileUrl } from "@std/path";

/** Absolute path of the repo root, with a trailing slash. */
export const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));

/** Absolute path of the published `docs/` folder (no trailing slash). */
export const DOCS = `${REPO_ROOT}docs`;

/** A running docs server: the base URL to browse, and how to stop it. */
export interface DocsServer {
  /** Base URL with a trailing slash, e.g. `http://127.0.0.1:54321/`. */
  url: string;
  /** Stops the server and waits for in-flight requests to finish. */
  shutdown: () => Promise<void>;
}

/** Pick an ephemeral local port by binding port 0 and reading the resolved port. */
function freePort(): number {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const { port } = listener.addr as Deno.NetAddr;
  listener.close();
  return port;
}

/**
 * Serve `docs/` on a free loopback port for a headless browser to load.
 *
 * Throws if the port cannot be bound — a verification script must fail loudly
 * rather than proceed against a server that never came up.
 */
export function serveDocsOnFreePort(): DocsServer {
  const port = freePort();
  const server = Deno.serve(
    { hostname: "127.0.0.1", port, onListen: () => {} },
    (req) => serveDir(req, { fsRoot: DOCS, quiet: true }),
  );
  return {
    url: `http://127.0.0.1:${port}/`,
    shutdown: async () => {
      await server.shutdown();
    },
  };
}
