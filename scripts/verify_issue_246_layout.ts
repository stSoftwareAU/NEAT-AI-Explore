/**
 * Capture screenshots for Issue #246 — Trace bar: stop collapsing controls
 * behind "⋯" when there is spare width.
 *
 * Loads docs/, navigates to the Trace Explorer, and snapshots the trace bar
 * at a wide viewport (controls should render inline) and a narrow viewport
 * (controls should collapse behind the "⋯" overflow popover).
 *
 * Usage (from repo root):
 *   deno run -A scripts/verify_issue_246_layout.ts
 */

import { chromium, type Page } from "playwright";

import { DOCS, serveDocsOnFreePort } from "./lib/serve_docs.ts";

const OUT_DIR = `${DOCS}/evidence`;

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
  const server = serveDocsOnFreePort();
  const url = server.url;

  try {
    const browser = await chromium.launch({ headless: true });
    try {
      // ---- Tablet (700px): plenty of room — controls inline. ----
      const wideCtx = await browser.newContext({
        viewport: { width: 700, height: 800 },
        colorScheme: "dark",
      });
      const wide = await wideCtx.newPage();
      await wide.goto(url, { waitUntil: "domcontentloaded" });
      await wide.waitForSelector("#overviewExploreBtn", { timeout: 30_000 });
      await wide.click("#overviewExploreBtn");
      await wide.waitForSelector(".traceBar", { state: "visible" });
      await waitForOverflowMode(wide, "inline");
      const wideBar = wide.locator(".traceBar").first();
      await wideBar.screenshot({
        path: `${OUT_DIR}/issue-246-wide-inline.png`,
      });
      console.log("Saved issue-246-wide-inline.png");
      await wideCtx.close();

      // ---- Narrow (360px): genuinely too narrow — controls collapsed. ----
      const narrowCtx = await browser.newContext({
        viewport: { width: 360, height: 800 },
        colorScheme: "dark",
      });
      const narrow = await narrowCtx.newPage();
      await narrow.goto(url, { waitUntil: "domcontentloaded" });
      await narrow.waitForSelector("#overviewExploreBtn", { timeout: 30_000 });
      await narrow.click("#overviewExploreBtn");
      await narrow.waitForSelector(".traceBar", { state: "visible" });
      await waitForOverflowMode(narrow, "collapsed");
      const narrowBar = narrow.locator(".traceBar").first();
      await narrowBar.screenshot({
        path: `${OUT_DIR}/issue-246-narrow-collapsed.png`,
      });
      console.log("Saved issue-246-narrow-collapsed.png");
      await narrowCtx.close();
    } finally {
      await browser.close();
    }
    return 0;
  } catch (e) {
    console.error("verify_issue_246_layout failed:", e);
    return 1;
  } finally {
    await server.shutdown();
  }
}

if (import.meta.main) {
  Deno.exit(await main());
}
