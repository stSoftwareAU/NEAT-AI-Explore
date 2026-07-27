/**
 * Capture screenshot evidence of the top-impact subgraph view for #527.
 *
 * Loads `/subgraph/` against a running local dev server, waits for the default
 * snapshot to be ranked and the subgraph rendered, then screenshots the page at
 * a desktop and a phone viewport. The strongest path is selected first so the
 * drill-down panel (and the observation summaries behind it) is visible in the
 * evidence.
 *
 * Targets an already-running server — this script does NOT spin one up.
 *
 * Usage (from repo root):
 *   deno run -A ./helpers/server.ts 8091 docs &
 *   deno run -A scripts/capture_subgraph_evidence.ts
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
          name: "issue-527-subgraph-desktop.png",
          viewport: { width: 1280, height: 900 },
        },
        {
          name: "issue-527-subgraph-phone.png",
          viewport: { width: 390, height: 844 },
        },
      ]
    ) {
      const context = await browser.newContext({
        viewport: shot.viewport,
        colorScheme: "dark",
      });
      try {
        const page = await context.newPage();
        console.log(`Navigating to ${BASE_URL}/subgraph/ (${shot.name})`);
        await page.goto(`${BASE_URL}/subgraph/`, {
          waitUntil: "domcontentloaded",
        });

        console.log("Waiting for the subgraph to render (up to 180 s)...");
        await page.waitForSelector(".dagSvg .dagNode", { timeout: 180_000 });
        await page.waitForTimeout(1_500);

        // Select the strongest path so the drill-down panel shows real content.
        await page.evaluate(`(() => {
          const picker = document.getElementById("pathPicker");
          const option = Array.from(picker?.options ?? [])
            .find((o) => o.value !== "");
          if (!picker || !option) return null;
          picker.value = option.value;
          picker.dispatchEvent(new Event("change"));
          return option.value;
        })()`);
        await page.waitForTimeout(500);

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
