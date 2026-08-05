/**
 * Capture screenshot evidence of the shared status/progress widget for #597.
 *
 * The four views now drive one controller (`docs/shared/progress_ui.js`), so
 * an unknown-size load pulses the `.indeterminate` bar everywhere — the DAG
 * and Subgraph views used to fake it with a static 35% bar and had no
 * `.indeterminate` CSS rule at all.
 *
 * The snapshot request is stalled (never fulfilled) so the loading state stays
 * on screen long enough to photograph; the screenshot is only taken once the
 * live DOM actually carries `#progressBar.indeterminate`, so it is evidence of
 * the real code path, not a hand-poked class.
 *
 * Targets an already-running server — this script does NOT spin one up.
 *
 * Usage (from repo root):
 *   deno run -A ./helpers/server.ts 8091 docs &
 *   deno run -A scripts/capture_issue_597_evidence.ts
 */

import { fromFileUrl } from "@std/path";
import { chromium } from "playwright";

const REPO_ROOT = fromFileUrl(new URL("..", import.meta.url));
const EVIDENCE_DIR = `${REPO_ROOT}docs/evidence`;
const BASE_URL = Deno.env.get("EVIDENCE_BASE_URL") ?? "http://localhost:8091";

const SHOTS = [
  {
    name: "issue-597-dag-indeterminate.png",
    path: "/dag/",
    blockWorker: false,
  },
  // The Subgraph view derives in a Web Worker whose fetch sits outside
  // Playwright's route table; blocking the worker script drops it onto the
  // main-thread fallback, which takes the same stalled (unknown-size) fetch.
  {
    name: "issue-597-subgraph-indeterminate.png",
    path: "/subgraph/",
    blockWorker: true,
  },
  { name: "issue-597-trace-indeterminate.png", path: "/", blockWorker: false },
];

async function main(): Promise<number> {
  await Deno.mkdir(EVIDENCE_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    for (const shot of SHOTS) {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 400 },
        colorScheme: "dark",
      });
      try {
        const page = await context.newPage();

        // Stall every snapshot fetch so the unknown-size loading state holds.
        await context.route("**/snapshot.json.gz*", async () => {
          await new Promise(() => {});
        });
        if (shot.blockWorker) {
          await context.route("**/subgraph_worker.js*", (route) => {
            route.abort();
          });
        }

        console.log(`Navigating to ${BASE_URL}${shot.path} (${shot.name})`);
        await page.goto(`${BASE_URL}${shot.path}`, {
          waitUntil: "domcontentloaded",
        });

        console.log("Waiting for the indeterminate progress bar...");
        await page.waitForSelector("#progressBar.indeterminate", {
          timeout: 30_000,
        });
        // Let the pulse animation move off its starting frame.
        await page.waitForTimeout(600);

        const out = `${EVIDENCE_DIR}/${shot.name}`;
        await page.screenshot({
          path: out,
          clip: {
            x: 0,
            y: 0,
            width: 1280,
            height: 180,
          },
        });
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

Deno.exit(await main());
