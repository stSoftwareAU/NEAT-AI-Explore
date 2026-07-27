/**
 * Capture screenshot evidence of the layered 2D DAG view for #525.
 *
 * Loads `/dag/` against a running local dev server, waits for the default
 * snapshot to aggregate and render, then screenshots the page at a desktop
 * and a phone viewport. A node is selected first so the details panel (and the
 * observation summaries behind the tooltips) is visible in the evidence.
 *
 * Targets an already-running server — this script does NOT spin one up.
 *
 * Usage (from repo root):
 *   deno run -A ./helpers/server.ts 8091 docs &
 *   deno run -A scripts/capture_dag_evidence.ts
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
          name: "issue-525-dag-desktop.png",
          viewport: { width: 1280, height: 900 },
        },
        {
          name: "issue-525-dag-phone.png",
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
        console.log(`Navigating to ${BASE_URL}/dag/ (${shot.name})`);
        await page.goto(`${BASE_URL}/dag/`, { waitUntil: "domcontentloaded" });

        console.log("Waiting for the diagram to render (up to 120 s)...");
        await page.waitForSelector(".dagSvg .dagNode", { timeout: 120_000 });
        await page.waitForTimeout(1_500);

        // Select the strongest observation family so the details panel shows
        // real content in the screenshot.
        await page.evaluate(`(() => {
          const picker = document.getElementById("nodePicker");
          const option = Array.from(picker?.options ?? [])
            .find((o) => o.value.startsWith("family:"));
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
