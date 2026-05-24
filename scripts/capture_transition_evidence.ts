/**
 * Capture screenshot evidence of smooth animated transitions for the
 * trace explorer and graph explorer views (Playwright, Deno port).
 *
 * Replaces the original `scripts/capture_transition_evidence.py` (Issue #226)
 * so the verification stack is single-language Deno + npm:playwright.
 *
 * Targets the already-running developer dev server at http://localhost:8091/
 * — this script does NOT spin up its own server. Start the dev server first,
 * then run this script.
 *
 * Outputs:
 * - docs/evidence/trace-explorer-transitions.png
 * - docs/evidence/graph-explorer-transitions.png
 *
 * Browser-side predicates are passed as source strings so Deno does not
 * type-check DOM globals (document, window) against its Deno-runtime libs.
 *
 * Usage (from repo root):
 *   deno run -A scripts/capture_transition_evidence.ts
 */

import { fromFileUrl } from "@std/path";
import { chromium } from "playwright";

const REPO_ROOT = fromFileUrl(new URL("..", import.meta.url));
const EVIDENCE_DIR = `${REPO_ROOT}docs/evidence`;
const BASE_URL = "http://localhost:8091";

function relToRoot(path: string): string {
  return path.startsWith(REPO_ROOT) ? path.slice(REPO_ROOT.length) : path;
}

async function main(): Promise<number> {
  await Deno.mkdir(EVIDENCE_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      colorScheme: "light",
    });
    try {
      const page = await context.newPage();

      // --- Trace Explorer (index / root) ---
      console.log(`Navigating to ${BASE_URL}/`);
      await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });

      // Wait for snapshot to load — the page fetches a large JSON.
      // Look for neuron-related content in the DOM to confirm data arrived.
      console.log(
        "Waiting for trace explorer to load snapshot (up to 60 s)...",
      );
      await page.waitForFunction(
        `(() => {
          const body = document.body?.innerText || '';
          return (
            body.includes('output-0') ||
            body.includes('Observations:') ||
            body.includes('neuron') ||
            body.includes('Score')
          );
        })()`,
        undefined,
        { timeout: 60_000 },
      );

      // Give animations and layout a moment to settle.
      await page.waitForTimeout(2_000);

      const traceOut = `${EVIDENCE_DIR}/trace-explorer-transitions.png`;
      await page.screenshot({ path: traceOut, fullPage: false });
      console.log(`Wrote ${relToRoot(traceOut)}`);

      // --- Graph Explorer ---
      console.log(`Navigating to ${BASE_URL}/graph/`);
      await page.goto(`${BASE_URL}/graph/`, { waitUntil: "domcontentloaded" });

      console.log(
        "Waiting for graph explorer to load snapshot (up to 60 s)...",
      );
      // Graph view signals success via #status with class "ok"; fall back to
      // body text if the status element is missing.
      await page.waitForFunction(
        `(() => {
          const el = document.getElementById('status');
          if (el) {
            const txt = (el.textContent || '').trim();
            const ok = el.classList.contains('ok');
            if (ok && txt.startsWith('Observations:')) return true;
          }
          const body = document.body?.innerText || '';
          return (
            body.includes('output-0') ||
            body.includes('Observations:') ||
            body.includes('neuron')
          );
        })()`,
        undefined,
        { timeout: 60_000 },
      );

      // Give WebGL and animations time to settle.
      await page.waitForTimeout(2_000);

      const graphOut = `${EVIDENCE_DIR}/graph-explorer-transitions.png`;
      await page.screenshot({ path: graphOut, fullPage: false });
      console.log(`Wrote ${relToRoot(graphOut)}`);
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }

  // Small pause to ensure file buffers flush on slower filesystems.
  await new Promise((r) => setTimeout(r, 100));
  console.log("Done.");
  return 0;
}

if (import.meta.main) {
  Deno.exit(await main());
}
