/**
 * Capture screenshots for Issue #245 — Inbound synapses: inline filter
 * controls + narrow-screen collapsed popover.
 *
 * The page enforces a strict CSP (no unsafe-eval), so all browser-side
 * predicates are passed as callable functions, not strings.
 *
 * Usage (from repo root):
 *   deno run -A scripts/verify_issue_245_layout.ts
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

async function waitForFiltersMode(
  page: Page,
  mode: string,
  timeoutMs = 10_000,
) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const got = await page
      .locator(".synapseHeader")
      .first()
      .getAttribute("data-filters-mode");
    if (got === mode) return;
    await page.waitForTimeout(150);
  }
  throw new Error(`data-filters-mode never reached "${mode}"`);
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
      // ---- Desktop: filter controls render inline with heading + sort. ----
      const deskCtx = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        colorScheme: "dark",
      });
      const desktop = await deskCtx.newPage();
      await desktop.goto(url, { waitUntil: "domcontentloaded" });
      await desktop.waitForSelector("#overviewExploreBtn", { timeout: 30_000 });
      await desktop.click("#overviewExploreBtn");
      await desktop.waitForSelector(".synapseHeader", {
        state: "visible",
        timeout: 10_000,
      });
      await waitForFiltersMode(desktop, "inline");
      await desktop.waitForTimeout(2_000);
      await desktop.screenshot({
        path: `${OUT_DIR}/issue-245-desktop-inline.png`,
        clip: { x: 0, y: 0, width: 1440, height: 380 },
      });
      console.log("Saved issue-245-desktop-inline.png");
      await deskCtx.close();

      // ---- Mobile: controls collapse behind the Filters popover. ----
      const mobCtx = await browser.newContext({
        viewport: { width: 420, height: 800 },
        colorScheme: "dark",
      });
      const mobile = await mobCtx.newPage();
      await mobile.goto(url, { waitUntil: "domcontentloaded" });
      await mobile.waitForSelector("#overviewExploreBtn", { timeout: 30_000 });
      await mobile.click("#overviewExploreBtn");
      // On tablet/mobile widths, the synapse panel slides in via the
      // #synapsePanelToggle button — open it before measuring.
      const toggle = mobile.locator("#synapsePanelToggle");
      if (await toggle.isVisible()) {
        await toggle.click();
      }
      await mobile.waitForSelector(".synapseHeader", {
        state: "visible",
        timeout: 10_000,
      });
      await waitForFiltersMode(mobile, "collapsed");
      // On mobile the .synapseList sits below the current-neuron card inside
      // a scrolling .explorerMain container — screenshot the locator itself
      // so the framed output captures the collapsed Filters button.
      const header = mobile.locator(".synapseHeader").first();
      await header.scrollIntoViewIfNeeded();
      await header.screenshot({
        path: `${OUT_DIR}/issue-245-mobile-collapsed.png`,
      });
      console.log("Saved issue-245-mobile-collapsed.png");

      // Open the popover and capture the .synapseList region (header +
      // popover) so both the trigger button and the revealed panel are in
      // frame.
      await mobile.locator("#synapseFiltersToggle").click();
      await mobile.waitForTimeout(300);
      await mobile
        .locator(".synapseList")
        .first()
        .screenshot({
          path: `${OUT_DIR}/issue-245-mobile-popover-open.png`,
        });
      console.log("Saved issue-245-mobile-popover-open.png");
      await mobCtx.close();
    } finally {
      await browser.close();
    }
    return 0;
  } catch (e) {
    console.error("verify_issue_245_layout failed:", e);
    return 1;
  } finally {
    await server.shutdown();
  }
}

if (import.meta.main) {
  Deno.exit(await main());
}
