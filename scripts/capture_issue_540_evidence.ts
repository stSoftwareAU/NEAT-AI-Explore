/**
 * Capture screenshot evidence of the phone-friendly Sankey layout for #540.
 *
 * Loads `/sankey/` against a running local dev server at a real phone viewport
 * and records three things: the reflowed page chrome with the diagram fitting
 * inside it, the same view pinch-zoomed in (via the keyboard-equivalent zoom
 * button, which drives the identical view state), and the unchanged desktop
 * layout.
 *
 * Targets an already-running server — this script does NOT spin one up.
 *
 * Usage (from repo root):
 *   deno run -A ./helpers/server.ts 8091 docs &
 *   deno run -A scripts/capture_issue_540_evidence.ts
 */

import { fromFileUrl } from "@std/path";
import { chromium } from "playwright";

const REPO_ROOT = fromFileUrl(new URL("..", import.meta.url));
const EVIDENCE_DIR = `${REPO_ROOT}docs/evidence`;
const BASE_URL = Deno.env.get("EVIDENCE_BASE_URL") ?? "http://localhost:8091";

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

async function main(): Promise<number> {
  await Deno.mkdir(EVIDENCE_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    for (
      const shot of [
        {
          name: "issue-540-sankey-phone.png",
          viewport: PHONE,
          hasTouch: true,
          zoom: false,
        },
        {
          name: "issue-540-sankey-phone-zoomed.png",
          viewport: PHONE,
          hasTouch: true,
          zoom: true,
        },
        {
          name: "issue-540-sankey-desktop.png",
          viewport: DESKTOP,
          hasTouch: false,
          zoom: false,
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

        console.log("Waiting for the diagram to render (up to 180 s)...");
        await page.waitForSelector(".sankey .sankeyNode", { timeout: 180_000 });
        await page.waitForTimeout(1_500);

        if (shot.zoom) {
          // Three presses of the zoom-in button ≈ 3.4x, the same view state a
          // pinch produces. Fail loud if the control is missing.
          const zoomIn = page.locator("#zoomIn");
          if (await zoomIn.count() === 0) {
            console.error("No #zoomIn control — the zoom route is missing.");
            return 1;
          }
          for (let i = 0; i < 3; i++) await zoomIn.click();
          await page.waitForTimeout(300);
        }

        // A page that overflows sideways is the regression being fixed. Passed
        // as a source string so this Deno-side script needs no DOM lib.
        const overflow = await page.evaluate(
          "document.documentElement.scrollWidth - document.documentElement.clientWidth",
        );
        console.log(`Horizontal overflow: ${overflow}px`);

        const labelled = await page.locator(".sankey .sankeyNodeLabel").count();
        const bands = await page.locator(".sankey .sankeyNode").count();
        console.log(`${labelled}/${bands} bands are labelled`);

        const out = `${EVIDENCE_DIR}/${shot.name}`;
        await page.screenshot({ path: out, fullPage: !shot.hasTouch });
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
