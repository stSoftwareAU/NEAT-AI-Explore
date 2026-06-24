/**
 * Capture screenshots for Issue #383 — tapping the trace-nav "⋯" (More
 * actions) did nothing on mobile, so the popover never revealed
 * Observations / 🧠 / Synapses.
 *
 * Loads docs/, navigates to the Trace Explorer at phone width so the
 * controls collapse behind "⋯", then taps the summary button and snapshots
 * the revealed popover. Confirms a single tap opens it (the bug was a
 * double-bound listener that cancelled the toggle out).
 *
 * Usage (from repo root):
 *   deno run -A scripts/verify_issue_383_overflow_popover.ts
 */

import { serveDir } from "@std/http/file-server";
import { fromFileUrl } from "@std/path";
import { chromium, type Page } from "playwright";

const REPO_ROOT = fromFileUrl(new URL("..", import.meta.url));
const DOCS = `${REPO_ROOT}docs`;
const OUT_DIR = `${DOCS}/evidence`;

function freePort(): number {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const { port } = listener.addr as Deno.NetAddr;
  listener.close();
  return port;
}

async function waitForOverflowMode(
  page: Page,
  mode: string,
  timeoutMs = 10_000,
) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const got = await page
      .locator(".traceOverflow")
      .first()
      .getAttribute("data-overflow-mode");
    if (got === mode) return;
    await page.waitForTimeout(150);
  }
  throw new Error(`data-overflow-mode never reached "${mode}"`);
}

async function main(): Promise<number> {
  await Deno.mkdir(OUT_DIR, { recursive: true });
  const port = freePort();
  const server = Deno.serve(
    { hostname: "127.0.0.1", port, onListen: () => {} },
    (req) => serveDir(req, { fsRoot: DOCS, quiet: true }),
  );
  const url = `http://127.0.0.1:${port}/`;

  try {
    const browser = await chromium.launch({ headless: true });
    try {
      const ctx = await browser.newContext({
        viewport: { width: 375, height: 812 },
        colorScheme: "dark",
      });
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("#overviewExploreBtn", { timeout: 30_000 });
      await page.click("#overviewExploreBtn");
      await page.waitForSelector(".traceBar", { state: "visible" });
      await waitForOverflowMode(page, "collapsed");

      // Closed state — popover hidden.
      await page.locator(".traceBar").first().screenshot({
        path: `${OUT_DIR}/issue-383-closed.png`,
      });
      console.log("Saved issue-383-closed.png");

      // One tap on "⋯" must reveal the popover (the #383 fix).
      await page.locator(".traceOverflowSummary").first().click();
      await page.waitForSelector(
        '.traceOverflow[data-overflow-open="true"] .traceOverflowMenu',
        { state: "visible", timeout: 5_000 },
      );
      // Clip the top of the viewport so the absolutely-positioned popover
      // (which sits below the bar) is captured alongside it.
      await page.screenshot({
        path: `${OUT_DIR}/issue-383-open.png`,
        clip: { x: 0, y: 0, width: 375, height: 420 },
      });
      console.log("Saved issue-383-open.png");
      await ctx.close();
    } finally {
      await browser.close();
    }
    return 0;
  } catch (e) {
    console.error("verify_issue_383_overflow_popover failed:", e);
    return 1;
  } finally {
    await server.shutdown();
  }
}

if (import.meta.main) {
  Deno.exit(await main());
}
