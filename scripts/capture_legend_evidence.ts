/**
 * Capture screenshot evidence of the topology diagram inline legend
 * (Issue #240) in both light and dark themes.
 *
 * Targets a running server at http://localhost:8091/ — this script does
 * NOT spin one up.
 *
 * Usage (from repo root):
 *   ./helpers/server.sh 8091 docs &
 *   deno run -A scripts/capture_legend_evidence.ts
 */

import { fromFileUrl } from "@std/path";
import { chromium } from "playwright";

const REPO_ROOT = fromFileUrl(new URL("..", import.meta.url));
const EVIDENCE_DIR = `${REPO_ROOT}docs/evidence`;
const BASE_URL = "http://localhost:8091";

async function capture(
  browser: import("playwright").Browser,
  scheme: "light" | "dark",
  out: string,
): Promise<void> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    colorScheme: scheme,
  });
  try {
    const page = await context.newPage();
    console.log(`[${scheme}] Navigating to ${BASE_URL}/`);
    await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".topoLegend", { timeout: 60_000 });
    await page.waitForTimeout(1_000);
    const card = await page.$(".overviewTopologyDiagram");
    if (!card) throw new Error("overviewTopologyDiagram not found");
    await card.screenshot({ path: out });
    console.log(`[${scheme}] Wrote ${out}`);
  } finally {
    await context.close();
  }
}

async function main(): Promise<number> {
  await Deno.mkdir(EVIDENCE_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    await capture(
      browser,
      "light",
      `${EVIDENCE_DIR}/issue-240-topology-legend-light.png`,
    );
    await capture(
      browser,
      "dark",
      `${EVIDENCE_DIR}/issue-240-topology-legend-dark.png`,
    );
  } finally {
    await browser.close();
  }

  return 0;
}

if (import.meta.main) {
  Deno.exit(await main());
}
