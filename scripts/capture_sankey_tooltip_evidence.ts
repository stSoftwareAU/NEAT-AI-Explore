/**
 * Capture screenshot evidence of the Sankey touch tooltip panel for #536.
 *
 * Loads `/sankey/` against a running local dev server at a phone viewport,
 * taps the strongest observation family, and screenshots the resulting
 * tooltip panel — the #521 observation summary that native SVG `<title>`
 * cannot show on touch. A desktop shot records that hover is unchanged.
 *
 * Targets an already-running server — this script does NOT spin one up.
 *
 * Usage (from repo root):
 *   deno run -A ./helpers/server.ts 8091 docs &
 *   deno run -A scripts/capture_sankey_tooltip_evidence.ts
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
          name: "issue-536-sankey-tooltip-phone.png",
          viewport: { width: 390, height: 844 },
          hasTouch: true,
        },
        {
          name: "issue-536-sankey-tooltip-desktop.png",
          viewport: { width: 1280, height: 900 },
          hasTouch: false,
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

        // Tap an observation family — its tooltip is the #521 summary that a
        // native <title> cannot show on touch.
        // Aim at the node's own rect: the group's bounding box also covers
        // bands drawn underneath it.
        const family = page.locator(
          '.sankeyNode[aria-label*="observation"] .sankeyNodeRect',
        );
        const target = (await family.count()) > 0
          ? family.first()
          : page.locator(".sankeyNode").first();
        // A real tap/click carries clientX/clientY, so the panel is positioned
        // at the finger rather than at the node's bounding box.
        if (shot.hasTouch) await target.tap({ force: true });
        else await target.click({ force: true });
        await page.waitForSelector("#tooltip.isVisible", { timeout: 10_000 });
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
