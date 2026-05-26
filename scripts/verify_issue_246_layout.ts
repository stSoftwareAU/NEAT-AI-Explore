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
