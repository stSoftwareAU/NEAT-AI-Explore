/**
 * Issue #529 evidence — starfield keyboard papercuts.
 *
 * Drives the real graph view in Chromium and proves two behaviours that unit
 * tests cannot reach (they need a live camera loop):
 *
 *   A. Typing a snapshot URL containing w/a/s/d/q/e into the header field no
 *      longer flies the camera.
 *   B. A movement key held when the window loses focus is released, instead of
 *      leaving the camera drifting forever.
 *
 * The verdicts are read from the camera itself via the in-page debug API, then
 * painted into the page so the screenshot shows measured numbers rather than a
 * claim. Exits non-zero if either check fails.
 *
 * Usage (from repo root):
 *   deno run -A docs/evidence/_issue_529_shot.ts
 */

import { serveDir } from "@std/http/file-server";
import { fromFileUrl } from "@std/path";
import { chromium } from "playwright";

const REPO_ROOT = fromFileUrl(new URL("../..", import.meta.url));
const DOCS = `${REPO_ROOT}docs`;
const OUT = `${DOCS}/evidence/issue-529-keyboard-fixes.png`;

/** A URL a user might realistically paste — note the w/a/s/d/q/e letters. */
const TYPED_URL = "https://stsoftwareau.github.io/NEAT-AI-Snapshot/wasdqe.gz";

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** The `window.__neatStarfield` surface (graph.js `exposeDebugApi`) used here. */
interface StarfieldDebugApi {
  getSnapshotLoaded(): boolean;
  getDefaultOutputUuid(): string | null;
  focusByUuid(uuid: string): boolean;
  getCameraPosition(): Vec3 | null;
  getHeldKeyCount(): number;
}

/** Page globals the browser-side callbacks below reach for. */
interface PageGlobals {
  document: {
    getElementById(id: string): {
      textContent: string | null;
      classList: { contains(token: string): boolean };
    } | null;
    createElement(tag: string): {
      style: { cssText: string };
      textContent: string;
    };
    body: { appendChild(node: unknown): void };
  };
  dispatchEvent(event: unknown): boolean;
  Event: new (type: string) => unknown;
  __neatStarfield?: StarfieldDebugApi;
}

function freePort(): number {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const { port } = listener.addr as Deno.NetAddr;
  listener.close();
  return port;
}

function distance(a: Vec3 | null, b: Vec3 | null): number {
  if (!a || !b) return Number.NaN;
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

async function main(): Promise<number> {
  const port = freePort();
  const server = Deno.serve(
    { hostname: "127.0.0.1", port, onListen: () => {} },
    (req) => serveDir(req, { fsRoot: DOCS, quiet: true }),
  );

  const lines: string[] = [];
  let failures = 0;
  /** Records a check, printing and collecting a PASS/FAIL line. */
  const record = (ok: boolean, text: string) => {
    if (!ok) failures++;
    const line = `${ok ? "PASS" : "FAIL"}  ${text}`;
    console.log(line);
    lines.push(line);
  };

  try {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        colorScheme: "dark",
      });
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${port}/graph/index.html`, {
        waitUntil: "domcontentloaded",
      });

      // Wait for the default snapshot to load, then settle on a neuron so the
      // camera has a stable resting position.
      await page.waitForFunction(
        () => {
          const { document } = globalThis as unknown as PageGlobals;
          const el = document.getElementById("status");
          if (!el) return false;
          return el.classList.contains("ok") &&
            (el.textContent || "").trim().startsWith("Observations:");
        },
        undefined,
        { timeout: 60_000 },
      );
      await page.waitForFunction(
        () =>
          Boolean(
            (globalThis as unknown as PageGlobals).__neatStarfield
              ?.getDefaultOutputUuid(),
          ),
        undefined,
        { timeout: 10_000 },
      );
      await page.evaluate(() => {
        const api = (globalThis as unknown as PageGlobals).__neatStarfield;
        const out = api?.getDefaultOutputUuid();
        if (out) api?.focusByUuid(out);
      });
      await page.waitForTimeout(2000);

      const readCamera = () =>
        page.evaluate(() =>
          (globalThis as unknown as PageGlobals).__neatStarfield
            ?.getCameraPosition() ?? null
        ) as Promise<Vec3 | null>;
      const readHeldKeys = () =>
        page.evaluate(() =>
          (globalThis as unknown as PageGlobals).__neatStarfield
            ?.getHeldKeyCount() ?? -1
        ) as Promise<number>;

      // ── A. Typing a URL must not fly the camera ─────────────────────────
      const before = await readCamera();
      // graph.js collapses the snapshot loader once the default snapshot lands.
      const urlField = page.locator("#fetchUrl");
      if (!(await urlField.isVisible())) {
        await page.click("#snapshotDetails > summary");
      }
      await urlField.fill(""); // start from empty so the shot reads cleanly
      await urlField.click();
      await page.type("#fetchUrl", TYPED_URL, { delay: 15 });
      await page.waitForTimeout(1200); // ample time for the fly loop to drift
      const after = await readCamera();
      const drift = distance(before, after);
      record(
        drift === 0,
        `Typing "${TYPED_URL}" moved the camera ${drift} world units ` +
          `(expected 0).`,
      );
      record(
        (await readHeldKeys()) === 0,
        `No camera keys are held after typing (expected 0, got ${await readHeldKeys()}).`,
      );

      // ── B. A held key survives neither blur nor a hidden tab ────────────
      await page.click("#glCanvas", { position: { x: 20, y: 700 } });
      await page.keyboard.down("w");
      const heldWhileDown = await readHeldKeys();
      record(
        heldWhileDown === 1,
        `Holding W over the canvas flies the camera (1 key held, got ${heldWhileDown}).`,
      );
      // The browser fires `blur` on the window when the user switches away;
      // dispatching it exercises the same listener graph.js registers.
      await page.evaluate(() => {
        const g = globalThis as unknown as PageGlobals;
        g.dispatchEvent(new g.Event("blur"));
      });
      const heldAfterBlur = await readHeldKeys();
      record(
        heldAfterBlur === 0,
        `Window blur released the stuck key (expected 0, got ${heldAfterBlur}).`,
      );
      const parked = await readCamera();
      await page.waitForTimeout(800);
      const stillParked = await readCamera();
      record(
        distance(parked, stillParked) === 0,
        `Camera stayed put after blur (drifted ${
          distance(parked, stillParked)
        } world units, expected 0).`,
      );
      await page.keyboard.up("w");

      // Paint the measured verdicts into the page so the screenshot is proof.
      await page.evaluate((report: string) => {
        const { document } = globalThis as unknown as PageGlobals;
        const box = document.createElement("div");
        box.textContent = report;
        box.style.cssText = [
          "position:fixed",
          "left:24px",
          "bottom:24px",
          "z-index:99999",
          "max-width:900px",
          "padding:14px 18px",
          "border-radius:8px",
          "background:#0d1117",
          "color:#e6edf3",
          "border:1px solid #2f81f7",
          "font:13px/1.7 ui-monospace, SFMono-Regular, Menlo, monospace",
          "white-space:pre-wrap",
          "box-shadow:0 8px 24px rgba(0,0,0,0.6)",
        ].join(";");
        document.body.appendChild(box);
      }, `Issue #529 — starfield keyboard fixes\n${lines.join("\n")}`);
      await page.waitForTimeout(300);

      await page.screenshot({ path: OUT, fullPage: false });
      console.log(`Wrote docs/evidence/${OUT.split("/").pop()}`);
      await context.close();
    } finally {
      await browser.close();
    }
  } finally {
    await server.shutdown();
  }

  if (failures > 0) {
    console.error(`${failures} check(s) failed.`);
    return 1;
  }
  return 0;
}

if (import.meta.main) {
  Deno.exit(await main());
}
