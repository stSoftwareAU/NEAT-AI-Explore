/**
 * Verify the Graph view in a real browser (Playwright, Deno port).
 *
 * Replaces the original `scripts/verify_starfield_layout.py` (Issue #224)
 * so the verification stack is single-language Deno + npm:playwright.
 *
 * Captures key screenshots showing:
 * - Initial render (graph)
 * - Click-to-focus (HUD visible)
 * - 3D interaction (drag-to-look + wheel zoom)
 *
 * Outputs:
 * - docs/screenshots/graph-desktop.png
 * - docs/screenshots/graph-desktop-focus.png
 * - docs/screenshots/graph-desktop-tilt.png
 *
 * Browser-side predicates are passed as source strings so Deno does not
 * type-check DOM globals (document, window) against its Deno-runtime libs.
 *
 * Usage (from repo root):
 *   deno run -A scripts/verify_starfield_layout.ts
 */

import { serveDir } from "@std/http/file-server";
import { fromFileUrl } from "@std/path";
import { chromium } from "playwright";

const REPO_ROOT = fromFileUrl(new URL("..", import.meta.url));
const DOCS = `${REPO_ROOT}docs`;
const OUT_DIR = `${DOCS}/screenshots`;

/** Pick an ephemeral local port by binding port 0 and reading the resolved port. */
function freePort(): number {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const { port } = listener.addr as Deno.NetAddr;
  listener.close();
  return port;
}

interface ServerHandle {
  url: string;
  shutdown: () => Promise<void>;
}

function startDocsServer(port: number): ServerHandle {
  const server = Deno.serve(
    { hostname: "127.0.0.1", port, onListen: () => {} },
    (req) => serveDir(req, { fsRoot: DOCS, quiet: true }),
  );
  return {
    url: `http://127.0.0.1:${port}/`,
    shutdown: async () => {
      await server.shutdown();
    },
  };
}

async function ensureOutDir(): Promise<void> {
  await Deno.mkdir(OUT_DIR, { recursive: true });
}

function relToRoot(path: string): string {
  return path.startsWith(REPO_ROOT) ? path.slice(REPO_ROOT.length) : path;
}

async function main(): Promise<number> {
  await ensureOutDir();

  const port = freePort();
  const server = startDocsServer(port);
  const url = `${server.url}graph/index.html`;

  try {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        colorScheme: "dark", // show the space vibe by default
      });
      const page = await context.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded" });

      // Wait for the canvas to exist and for the renderer to have a moment
      // to draw a frame.
      await page.waitForSelector("#glCanvas", { timeout: 5000 });

      // The key: do not screenshot until the snapshot has loaded.
      //
      // In graph.js, successful loads set:
      // - #status text to "Observations: ..."
      // - and kind "ok" (class: statusInline ok)
      await page.waitForFunction(
        `(() => {
          const el = document.getElementById('status');
          if (!el) return false;
          const txt = (el.textContent || '').trim();
          const ok = el.classList.contains('ok');
          return ok && txt.startsWith('Observations:');
        })()`,
        undefined,
        { timeout: 60_000 },
      );

      // Give WebGL a couple of frames to settle so point sprites are visible.
      await page.waitForTimeout(300);

      // Verify we can explore from output neurons to discover issues.
      // Use the in-page debug API (added for screenshot automation).
      await page.waitForFunction(
        `Boolean(window.__neatStarfield && window.__neatStarfield.getSnapshotLoaded())`,
        undefined,
        { timeout: 10_000 },
      );
      await page.waitForFunction(
        `Boolean(window.__neatStarfield.getDefaultOutputUuid())`,
        undefined,
        { timeout: 10_000 },
      );

      // Start at output-0 (or first output).
      await page.evaluate(
        `(() => {
          const api = window.__neatStarfield;
          const out = api.getDefaultOutputUuid();
          api.focusByUuid(out);
        })()`,
      );
      await page.waitForFunction(
        `(() => {
          const txt = (document.getElementById('hud')?.textContent || '');
          return txt.includes('Focus:') && (txt.includes('output-0') || txt.includes('Score'));
        })()`,
        undefined,
        { timeout: 10_000 },
      );

      const out0 = `${OUT_DIR}/graph-desktop.png`;
      await page.screenshot({ path: out0, fullPage: false });
      console.log(`Wrote ${relToRoot(out0)}`);

      // Hop to a directly linked neighbour and ensure the focus badge/HUD changes.
      await page.evaluate(
        `(() => {
          const api = window.__neatStarfield;
          const out = api.getDefaultOutputUuid();
          const neigh = api.getNeighbourUuids(out);
          if (neigh && neigh.length) api.focusByUuid(neigh[0]);
        })()`,
      );
      await page.waitForFunction(
        `(() => {
          const hud = document.getElementById('hud');
          const txt = (hud?.textContent || '');
          return txt.includes('Focus:') && !txt.includes('output-0') && !txt.includes('Score');
        })()`,
        undefined,
        { timeout: 10_000 },
      );

      // Now jump to the highest-risk neighbour of output and ensure flags are
      // visible (if any).
      await page.evaluate(
        `(() => {
          const api = window.__neatStarfield;
          const out = api.getDefaultOutputUuid();
          const risky = api.pickHighestRiskNeighbour(out);
          if (risky) api.focusByUuid(risky);
        })()`,
      );
      await page.waitForTimeout(250);

      const out1 = `${OUT_DIR}/graph-desktop-focus.png`;
      await page.screenshot({ path: out1, fullPage: false });
      console.log(`Wrote ${relToRoot(out1)}`);

      // Tilt the view and zoom a bit to demonstrate 3D control.
      await page.mouse.move(640, 400);
      await page.mouse.down();
      await page.mouse.move(820, 520, { steps: 12 });
      await page.mouse.up();
      await page.mouse.wheel(0, -480);
      await page.waitForTimeout(300);

      const out2 = `${OUT_DIR}/graph-desktop-tilt.png`;
      await page.screenshot({ path: out2, fullPage: false });
      console.log(`Wrote ${relToRoot(out2)}`);

      await context.close();
    } finally {
      await browser.close();
    }
  } finally {
    await server.shutdown();
  }

  // Small pause to ensure file buffers flush on slower filesystems.
  await new Promise((r) => setTimeout(r, 100));
  return 0;
}

if (import.meta.main) {
  Deno.exit(await main());
}
