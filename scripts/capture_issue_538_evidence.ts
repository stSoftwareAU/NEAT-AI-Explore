/**
 * Capture screenshot evidence of the folded-tail inspector for #538.
 *
 * Loads `/sankey/` against a running local dev server, selects the folded
 * "other" node, and screenshots the resulting list — the folded members ranked
 * weakest-first with their share of the Score, and the zero-flow (dead) ones
 * called out. A phone shot records that the list is usable on a small screen.
 *
 * Targets an already-running server — this script does NOT spin one up.
 *
 * Usage (from repo root):
 *   deno run -A ./helpers/server.ts 8091 docs &
 *   deno run -A scripts/capture_issue_538_evidence.ts
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
    for (
      const shot of [
        {
          name: "issue-538-sankey-fold-desktop.png",
          viewport: { width: 1280, height: 900 },
          hasTouch: false,
        },
        {
          name: "issue-538-sankey-fold-phone.png",
          viewport: { width: 390, height: 844 },
          hasTouch: true,
        },
      ]
    ) {
      const context = await browser.newContext({
        viewport: shot.viewport,
        hasTouch: shot.hasTouch,
        colorScheme: "dark",
      });
      try {
        const page = await context.newPage();
        console.log(`Navigating to ${BASE_URL}/sankey/ (${shot.name})`);
        await page.goto(`${BASE_URL}/sankey/`, {
          waitUntil: "domcontentloaded",
        });

        console.log("Waiting for the diagram to render (up to 120 s)...");
        await page.waitForSelector(".sankey .sankeyNode", { timeout: 120_000 });
        await page.waitForTimeout(1_500);

        // Select the folded node — before #538 this band was a dead end.
        const folded = page.locator(".sankeyNode.isFolded .sankeyNodeRect");
        if (await folded.count() === 0) {
          // Fail loud: no fold means the evidence would not show the fix.
          console.error("No folded 'other' node in this snapshot.");
          return 1;
        }
        if (shot.hasTouch) await folded.first().tap({ force: true });
        else await folded.first().click({ force: true });

        await page.waitForSelector("#foldPanel.isVisible", { timeout: 10_000 });
        await page.locator("#foldPanel").scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);

        const out = `${EVIDENCE_DIR}/${shot.name}`;
        await page.screenshot({ path: out });
        console.log(`Wrote ${out}`);
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
