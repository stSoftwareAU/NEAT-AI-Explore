/**
 * Capture screenshot evidence of the upgraded topology diagram for #239.
 *
 * Loads the overview dashboard against the running local dev server and
 * screenshots the `.topoSvg` element so the new log-scaled dot/link sizes
 * and diverging weight-sum colour are visible.
 *
 * Targets the already-running server at http://localhost:8091/ — this
 * script does NOT spin one up.
 *
 * Usage (from repo root):
 *   ./helpers/server.sh 8091 docs &
 *   deno run -A scripts/capture_topology_evidence.ts
 */

import { fromFileUrl } from "@std/path";
import { chromium } from "playwright";

const REPO_ROOT = fromFileUrl(new URL("..", import.meta.url));
const EVIDENCE_DIR = `${REPO_ROOT}docs/evidence`;
const BASE_URL = "http://localhost:8091";

async function main(): Promise<number> {
  await Deno.mkdir(EVIDENCE_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      colorScheme: "light",
    });
    try {
      const page = await context.newPage();

      console.log(`Navigating to ${BASE_URL}/`);
      await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });

      // The overview dashboard renders the topology SVG once a snapshot
      // has loaded; wait for the topoSvg element to be present.
      console.log("Waiting for .topoSvg to render (up to 60 s)...");
      await page.waitForSelector(".topoSvg", { timeout: 60_000 });
      await page.waitForTimeout(1_000);

      const card = await page.$("#overview-topology, .topoSvg");
      if (!card) throw new Error("topology element not found after load");

      const out = `${EVIDENCE_DIR}/issue-239-topology-diagram.png`;
      await card.screenshot({ path: out });
      console.log(`Wrote ${out}`);
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }

  return 0;
}

if (import.meta.main) {
  Deno.exit(await main());
}
