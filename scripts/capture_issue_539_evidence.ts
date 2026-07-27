/**
 * Capture screenshot evidence of the observation-family bands for #539.
 *
 * Loads `/sankey/` against a running local dev server and screenshots layer 0.
 * Before #539 the derivation produced ~2,132 single-observation "families", so
 * the bands were individual observation labels; afterwards they are aggregate
 * families ("volume", "treasury", "dividend", …) with a member count.
 *
 * Targets an already-running server — this script does NOT spin one up.
 *
 * Usage (from repo root):
 *   deno run -A ./helpers/server.ts 8091 docs &
 *   deno run -A scripts/capture_issue_539_evidence.ts
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
      viewport: { width: 1280, height: 900 },
      // The layer-0 band labels are ~5 CSS px tall; oversample so the close-up
      // is legible in the PR.
      deviceScaleFactor: 4,
      colorScheme: "dark",
    });
    try {
      const page = await context.newPage();
      console.log(`Navigating to ${BASE_URL}/sankey/`);
      await page.goto(`${BASE_URL}/sankey/`, { waitUntil: "domcontentloaded" });

      console.log("Waiting for the diagram to render (up to 180 s)...");
      await page.waitForSelector(".sankey .sankeyNode", { timeout: 180_000 });
      await page.waitForTimeout(2_000);

      // Fail loud if layer 0 did not aggregate — the shot would not show the
      // fix and a silent pass would be worse than no evidence.
      const bands = await page.locator(".sankey .sankeyNode").count();
      console.log(`Rendered ${bands} band(s)`);
      if (bands === 0) {
        console.error("No Sankey bands rendered.");
        return 1;
      }

      const out = `${EVIDENCE_DIR}/issue-539-sankey-observation-families.png`;
      await page.screenshot({ path: out });
      console.log(`Wrote ${out}`);

      // Layer-0 close-up: the band labels are the point of #539, and they are
      // unreadable in the full-page shot.
      const box = await page.locator(".sankey").first().boundingBox();
      if (!box) {
        console.error("Could not measure the diagram.");
        return 1;
      }
      const zoom = `${EVIDENCE_DIR}/issue-539-sankey-layer0-labels.png`;
      await page.screenshot({
        path: zoom,
        clip: {
          x: box.x,
          y: box.y,
          width: Math.min(box.width * 0.34, box.width),
          height: box.height,
        },
        scale: "device",
      });
      console.log(`Wrote ${zoom}`);

      const families = await page.locator(".sankey .sankeyNodeLabel")
        .allTextContents();
      console.log(
        `Layer-0 band labels: ${JSON.stringify(families.slice(0, 20))}`,
      );
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
  return 0;
}

Deno.exit(await main());
