/**
 * Capture screenshot evidence of the topology pop-out modal for Issue #241.
 *
 * Loads the overview dashboard, waits for the in-place topology diagram to
 * render, clicks the diagram background to open the pop-out modal, then
 * screenshots the modal in both the light and dark themes.
 *
 * Targets the already-running server at http://localhost:8091/ — this script
 * does NOT spin one up.
 *
 * Usage (from repo root):
 *   ./helpers/server.sh 8091 docs &
 *   deno run -A scripts/capture_topo_modal_evidence.ts
 */

import { fromFileUrl } from "@std/path";
import { chromium, type Page } from "playwright";

const REPO_ROOT = fromFileUrl(new URL("..", import.meta.url));
const EVIDENCE_DIR = `${REPO_ROOT}docs/evidence`;
const BASE_URL = "http://localhost:8091";

async function openModalAndShoot(
  page: Page,
  outFile: string,
): Promise<void> {
  console.log("Waiting for .topoSvg to render (up to 60 s)...");
  await page.waitForSelector(".topoSvg", { timeout: 60_000 });
  await page.waitForTimeout(500);

  // Click the diagram background (not a dot) to open the pop-out modal. The
  // container reliably hosts a background click region.
  console.log("Clicking the diagram background to open the modal");
  await page.click("#overviewTopology");

  await page.waitForSelector("#topoModal:not([hidden])", { timeout: 5_000 });
  await page.waitForTimeout(400);
  console.log(`Capturing ${outFile}`);
  await page.screenshot({ path: outFile, fullPage: false });
}

async function main(): Promise<number> {
  await Deno.mkdir(EVIDENCE_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    for (const scheme of ["light", "dark"] as const) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        colorScheme: scheme,
      });
      try {
        const page = await context.newPage();
        console.log(`\n--- ${scheme} theme ---`);
        await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
        await openModalAndShoot(
          page,
          `${EVIDENCE_DIR}/issue-241-topo-modal-${scheme}.png`,
        );
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  return 0;
}

if (import.meta.main) {
  Deno.exit(await main());
}
