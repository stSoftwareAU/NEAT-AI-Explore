/**
 * Verify theme + responsive layout in a real browser (Playwright, Deno port).
 *
 * Replaces the original `scripts/verify_theme_layout.py` (Issue #225) so the
 * verification stack is single-language Deno + npm:playwright.
 *
 * Captures viewport screenshots for:
 * - iPhone / iPad / Desktop
 * - Theme modes: light/dark plus auto (light + dark system preference)
 *
 * Outputs land in a dot-folder so git ignores them: `.verify_screens/`.
 *
 * Australian English note:
 * - This is a developer verification tool (not runtime code).
 *
 * Usage (from repo root):
 *   deno run -A scripts/verify_theme_layout.ts
 */

import { serveDir } from "@std/http/file-server";
import { fromFileUrl } from "@std/path";
import { chromium } from "playwright";

const REPO_ROOT = fromFileUrl(new URL("..", import.meta.url));
const DOCS = `${REPO_ROOT}docs`;
const OUT_DIR = `${REPO_ROOT}.verify_screens`;

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

/** Slug helper — mirrors the Python `_slug` behaviour. */
function slug(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface Viewport {
  name: string;
  size: { width: number; height: number };
  isMobile: boolean;
  hasTouch: boolean;
}

interface Scenario {
  mode: "light" | "dark" | "auto";
  colourScheme: "light" | "dark";
  label: string;
}

const VIEWPORTS: Viewport[] = [
  {
    name: "iphone",
    size: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  },
  {
    name: "ipad",
    size: { width: 768, height: 1024 },
    isMobile: true,
    hasTouch: true,
  },
  {
    name: "desktop",
    size: { width: 1280, height: 800 },
    isMobile: false,
    hasTouch: false,
  },
];

// For auto mode we want to see both outcomes (system light/system dark).
const SCENARIOS: Scenario[] = [
  { mode: "light", colourScheme: "light", label: "light" },
  { mode: "dark", colourScheme: "dark", label: "dark" },
  { mode: "auto", colourScheme: "light", label: "auto-light" },
  { mode: "auto", colourScheme: "dark", label: "auto-dark" },
];

async function main(): Promise<number> {
  await ensureOutDir();

  const port = freePort();
  const server = startDocsServer(port);
  const baseUrl = server.url;

  try {
    const browser = await chromium.launch({ headless: true });
    try {
      for (const vp of VIEWPORTS) {
        for (const s of SCENARIOS) {
          const context = await browser.newContext({
            viewport: vp.size,
            colorScheme: s.colourScheme,
            isMobile: vp.isMobile,
            hasTouch: vp.hasTouch,
          });
          try {
            await context.addInitScript(
              `localStorage.setItem('themeMode', '${s.mode}');`,
            );
            const page = await context.newPage();
            await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

            // Give the app time to load and render.
            await page.waitForTimeout(1500);

            const outName = `${vp.name}-${slug(s.label)}.png`;
            const outPath = `${OUT_DIR}/${outName}`;
            await page.screenshot({ path: outPath, fullPage: false });
            console.log(`Wrote ${relToRoot(outPath)}`);

            // Extra verification states for key layouts:
            // - iPhone: touch tooltip + impact modal
            // - Desktop: impact modal
            const wantsExtras = s.label === "light" || s.label === "dark";

            if (wantsExtras && vp.name === "iphone") {
              // Show a touch tooltip via press-and-hold on an element with a title.
              try {
                await page.waitForSelector(".hasTooltip", { timeout: 3000 });
                await page.dispatchEvent(".hasTooltip", "touchstart");
                await page.waitForTimeout(520);
                const outTooltip = `${OUT_DIR}/${vp.name}-${
                  slug(s.label)
                }-tooltip.png`;
                await page.screenshot({
                  path: outTooltip,
                  fullPage: false,
                });
                console.log(`Wrote ${relToRoot(outTooltip)}`);
              } catch (_err) {
                // Selector or screenshot failed — keep going so the other
                // scenarios still produce output.
              } finally {
                try {
                  await page.dispatchEvent(".hasTooltip", "touchend");
                } catch (_err) {
                  // Best-effort cleanup.
                }
              }

              // Open the impact allocation modal.
              try {
                await page.waitForSelector("button.impactBreakdownBtn", {
                  timeout: 3000,
                });
                await page.click("button.impactBreakdownBtn");
                await page.waitForTimeout(250);
                const outModal = `${OUT_DIR}/${vp.name}-${
                  slug(s.label)
                }-modal.png`;
                await page.screenshot({ path: outModal, fullPage: false });
                console.log(`Wrote ${relToRoot(outModal)}`);
              } catch (_err) {
                // Best-effort: skip silently if the modal trigger is missing.
              } finally {
                try {
                  await page.click("#pathModalClose");
                } catch (_err) {
                  // Best-effort cleanup.
                }
              }
            }

            if (wantsExtras && vp.name === "desktop") {
              try {
                await page.waitForSelector("button.impactBreakdownBtn", {
                  timeout: 3000,
                });
                await page.click("button.impactBreakdownBtn");
                await page.waitForTimeout(250);
                const outModal = `${OUT_DIR}/${vp.name}-${
                  slug(s.label)
                }-modal.png`;
                await page.screenshot({ path: outModal, fullPage: false });
                console.log(`Wrote ${relToRoot(outModal)}`);
              } catch (_err) {
                // Best-effort: skip silently if the modal trigger is missing.
              } finally {
                try {
                  await page.click("#pathModalClose");
                } catch (_err) {
                  // Best-effort cleanup.
                }
              }
            }
          } finally {
            await context.close();
          }
        }
      }
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
