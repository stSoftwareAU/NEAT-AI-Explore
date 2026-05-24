/**
 * Verify the deployed PWA app shells boot cleanly under their declared
 * Content-Security-Policy (Issue #218).
 *
 * For each entry page (`/`, `/graph/`, `/starfield/`):
 *   1. Load it in headless Chromium with offline snapshots forced (no
 *      cross-origin fetch needed for a smoke render).
 *   2. Capture CSP violation events and any console errors that mention CSP.
 *   3. Take a screenshot to docs/evidence/.
 *
 * Exits non-zero if any CSP violation was observed.
 *
 * Usage (from repo root):
 *   deno run -A scripts/verify_csp.ts
 */

import { serveDir } from "@std/http/file-server";
import { fromFileUrl } from "@std/path";
import { chromium } from "playwright";

const REPO_ROOT = fromFileUrl(new URL("..", import.meta.url));
const DOCS = `${REPO_ROOT}docs`;
const OUT_DIR = `${REPO_ROOT}docs/evidence`;

function freePort(): number {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const { port } = listener.addr as Deno.NetAddr;
  listener.close();
  return port;
}

async function ensureOutDir(): Promise<void> {
  await Deno.mkdir(OUT_DIR, { recursive: true });
}

interface PageCheck {
  pathname: string;
  evidenceName: string;
}

const PAGES: PageCheck[] = [
  { pathname: "/index.html", evidenceName: "csp-trace.png" },
  { pathname: "/graph/index.html", evidenceName: "csp-graph.png" },
  { pathname: "/starfield/index.html", evidenceName: "csp-starfield.png" },
];

async function main(): Promise<number> {
  await ensureOutDir();
  const port = freePort();
  const server = Deno.serve(
    { hostname: "127.0.0.1", port, onListen: () => {} },
    (req) => serveDir(req, { fsRoot: DOCS, quiet: true }),
  );
  const base = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch({ headless: true });
  let exitCode = 0;
  try {
    for (const { pathname, evidenceName } of PAGES) {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
      });
      const page = await context.newPage();

      const violations: string[] = [];
      // Browsers fire a `securitypolicyviolation` event when CSP blocks a
      // resource. Capture it from the page context. The script body runs in
      // the browser, but Deno still type-checks it against Deno globals —
      // pass the body as a string so Deno doesn't try to resolve DOM types.
      await page.addInitScript(
        `globalThis.__cspViolations = [];
         addEventListener("securitypolicyviolation", (e) => {
           globalThis.__cspViolations.push({
             directive: e.violatedDirective,
             blockedURI: e.blockedURI,
             sourceFile: e.sourceFile,
           });
         });`,
      );

      const warnings: string[] = [];
      page.on("console", (msg) => {
        const text = msg.text();
        // Benign meta-CSP parser warnings (frame-ancestors, sandbox,
        // report-uri ignored when delivered via <meta>) are not violations.
        if (/is ignored when delivered via a <meta>/i.test(text)) {
          warnings.push(`info: ${text}`);
          return;
        }
        if (/refused to (load|connect|execute|apply)/i.test(text)) {
          violations.push(`console: ${text}`);
        }
      });

      const url = `${base}${pathname}?noSw=1`;
      console.log(`Loading ${url}`);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
      // Give the boot script a beat to run.
      await page.waitForTimeout(1500);

      // Pass evaluate body as a string so Deno's type checker doesn't try to
      // resolve `globalThis.__cspViolations` against Deno's global types.
      const pageViolations = await page.evaluate(
        "globalThis.__cspViolations ?? []",
      ) as unknown[];

      for (const v of pageViolations) {
        violations.push(`violation: ${JSON.stringify(v)}`);
      }

      const screenshotPath = `${OUT_DIR}/${evidenceName}`;
      await page.screenshot({ path: screenshotPath, fullPage: false });
      console.log(`  → screenshot: ${screenshotPath.slice(REPO_ROOT.length)}`);

      if (violations.length > 0) {
        console.error(`  ✗ ${pathname} produced CSP violations:`);
        for (const v of violations) console.error(`    - ${v}`);
        exitCode = 1;
      } else {
        console.log(`  ✓ ${pathname} loaded with no CSP violations`);
      }
      for (const w of warnings) console.log(`    ${w}`);

      await context.close();
    }
  } finally {
    await browser.close();
    await server.shutdown();
  }
  return exitCode;
}

if (import.meta.main) {
  Deno.exit(await main());
}
