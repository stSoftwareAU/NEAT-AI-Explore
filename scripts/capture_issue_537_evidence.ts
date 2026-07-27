/**
 * Capture screenshot evidence of the Sankey click/tap-to-trace flow for #537.
 *
 * Loads `/sankey/` against a running local dev server, selects the strongest
 * observation family, and screenshots the traced flow — the family's full path
 * to the Score highlighted, every unrelated band dimmed, and the details panel
 * reporting the selection's share of the Score.
 *
 * Targets an already-running server — this script does NOT spin one up.
 *
 * Usage (from repo root):
 *   deno run -A ./helpers/server.ts 8091 docs &
 *   deno run -A scripts/capture_issue_537_evidence.ts
 */

import { fromFileUrl } from "@std/path";
import { chromium } from "playwright";

const REPO_ROOT = fromFileUrl(new URL("..", import.meta.url));
const EVIDENCE_DIR = `${REPO_ROOT}docs/evidence`;
const BASE_URL = Deno.env.get("EVIDENCE_BASE_URL") ?? "http://localhost:8091";

async function main(): Promise<number> {
  await Deno.mkdir(EVIDENCE_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 1000 },
      colorScheme: "dark",
    });
    try {
      const page = await context.newPage();
      console.log(`Navigating to ${BASE_URL}/sankey/`);
      await page.goto(`${BASE_URL}/sankey/`, { waitUntil: "domcontentloaded" });

      console.log("Waiting for the diagram to render (up to 120 s)...");
      await page.waitForSelector(".sankey .sankeyNode", { timeout: 120_000 });
      await page.waitForTimeout(1_500);

      // Select the strongest observation family and trace its flow to the Score.
      const family = page.locator(
        '.sankeyNode[aria-label*="observation"] .sankeyNodeRect',
      );
      const target = (await family.count()) > 0
        ? family.first()
        : page.locator(".sankeyNode").first();
      await target.click({ force: true });

      // Highlight/dim classes and the details panel confirm the trace applied.
      await page.waitForSelector("svg.sankey.hasSelection", {
        timeout: 10_000,
      });
      await page.waitForSelector(".sankeyNode.isSelected", { timeout: 10_000 });
      await page.waitForSelector(".detailsTitle", { timeout: 10_000 });
      await page.waitForTimeout(300);

      const out = `${EVIDENCE_DIR}/issue-537-sankey-trace.png`;
      await page.screenshot({ path: out, fullPage: true });
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
