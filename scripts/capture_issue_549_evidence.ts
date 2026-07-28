/**
 * Capture screenshot evidence of the Service Worker serving the correct app
 * shell for the compare and sankey entry pages (#549).
 *
 * Before the fix, sw.js knew only graph/starfield/dag/subgraph, so a
 * navigation to `/compare/` was answered with the root Explorer shell and its
 * relative asset URLs 404'd — an unstyled, broken page. This script loads the
 * root page first so the Service Worker installs and takes control, then
 * navigates to each new page *through* the Service Worker and screenshots it.
 *
 * Targets an already-running server — this script does NOT spin one up.
 *
 * Usage (from repo root):
 *   deno run -A ./helpers/server.ts 8091 docs &
 *   deno run -A scripts/capture_issue_549_evidence.ts
 */

import { fromFileUrl } from "@std/path";
import { chromium } from "playwright";

const REPO_ROOT = fromFileUrl(new URL("..", import.meta.url));
const EVIDENCE_DIR = `${REPO_ROOT}docs/evidence`;
const BASE_URL = Deno.env.get("EVIDENCE_BASE_URL") ?? "http://localhost:8091";

const PAGES = [
  { path: "/compare/", name: "issue-549-compare-sw-shell.png" },
  { path: "/sankey/", name: "issue-549-sankey-sw-shell.png" },
];

async function main(): Promise<number> {
  await Deno.mkdir(EVIDENCE_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      colorScheme: "dark",
    });
    try {
      const page = await context.newPage();

      // Load the root shell so boot.js registers sw.js, then wait for it to
      // control the page — otherwise navigations bypass the Service Worker
      // and the routing under test never runs.
      console.log(`Registering the Service Worker via ${BASE_URL}/`);
      await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
      // Cast inside the browser context: Deno's DOM lib omits
      // Navigator.serviceWorker, which only exists in the page.
      await page.waitForFunction(
        () =>
          (navigator as unknown as {
            serviceWorker: { controller: unknown };
          }).serviceWorker.controller !== null,
        null,
        { timeout: 60_000 },
      );
      console.log("Service Worker is controlling the page");

      for (const shot of PAGES) {
        console.log(`Navigating to ${BASE_URL}${shot.path} (via the SW)`);
        await page.goto(`${BASE_URL}${shot.path}`, {
          waitUntil: "domcontentloaded",
        });
        // The served shell decides which stylesheet loads; give it a moment to
        // paint before capturing.
        await page.waitForTimeout(2_000);
        const target = `${EVIDENCE_DIR}/${shot.name}`;
        await page.screenshot({ path: target });
        console.log(`Saved ${target}`);
      }
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
  return 0;
}

Deno.exit(await main());
