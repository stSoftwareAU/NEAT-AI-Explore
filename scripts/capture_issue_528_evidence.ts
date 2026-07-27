/**
 * Capture screenshot evidence for the candidate comparison work (#528).
 *
 * Screenshots:
 *   - /compare/ launcher cards (desktop + phone) — no snapshot fetch needed;
 *   - /compare/ side-by-side iframes (desktop) — best-effort, needs network;
 *   - /subgraph/ top-impact subgraph (desktop) — best-effort, needs network.
 *
 * Targets an already-running server — this script does NOT spin one up.
 *
 * Usage (from repo root):
 *   python3 -m http.server 8091 --directory docs &
 *   deno run -A scripts/capture_issue_528_evidence.ts
 */

import { fromFileUrl } from "@std/path";
import { type Browser, chromium, type Page } from "playwright";

interface Shot {
  name: string;
  url: string;
  viewport: { width: number; height: number };
  waitFor?: string;
  prepare?: (page: Page) => Promise<void>;
}

const REPO_ROOT = fromFileUrl(new URL("..", import.meta.url));
const EVIDENCE_DIR = `${REPO_ROOT}docs/evidence`;
const BASE_URL = Deno.env.get("EVIDENCE_BASE_URL") ?? "http://localhost:8091";

async function shot(
  browser: Browser,
  { name, url, viewport, prepare, waitFor }: Shot,
) {
  const context = await browser.newContext({ viewport, colorScheme: "dark" });
  try {
    const page = await context.newPage();
    console.log(`Navigating to ${url} (${name})`);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    if (waitFor) {
      try {
        await page.waitForSelector(waitFor, { timeout: 60_000 });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`  waitFor ${waitFor} timed out: ${msg}`);
      }
    }
    if (prepare) await prepare(page);
    await page.waitForTimeout(1_200);
    const out = `${EVIDENCE_DIR}/${name}`;
    await page.screenshot({ path: out, fullPage: true });
    console.log(`Wrote ${out}`);
  } finally {
    await context.close();
  }
}

async function main(): Promise<number> {
  await Deno.mkdir(EVIDENCE_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    await shot(browser, {
      name: "issue-528-compare-desktop.png",
      url: `${BASE_URL}/compare/`,
      viewport: { width: 1280, height: 900 },
      waitFor: ".card",
    });
    await shot(browser, {
      name: "issue-528-compare-phone.png",
      url: `${BASE_URL}/compare/`,
      viewport: { width: 390, height: 844 },
      waitFor: ".card",
    });
    await shot(browser, {
      name: "issue-528-subgraph-desktop.png",
      url: `${BASE_URL}/subgraph/`,
      viewport: { width: 1280, height: 900 },
      waitFor: ".subgraph .subgraphNode",
    });
  } finally {
    await browser.close();
  }
  return 0;
}

if (import.meta.main) {
  Deno.exit(await main());
}
