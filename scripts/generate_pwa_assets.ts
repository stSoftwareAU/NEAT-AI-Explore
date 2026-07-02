/**
 * Generate PWA assets for NEAT-AI Explore — Deno port (Issue #227).
 *
 * Replaces the original `scripts/generate_pwa_assets.py` so the
 * verification stack is single-language Deno + npm:playwright + npm:jimp.
 *
 * Outputs:
 * - docs/icons/icon-source.png
 * - docs/icons/icon-<size>x<size>.png for ICON_SIZES
 * - docs/favicon.ico (16/32/48 multi-resolution)
 * - docs/screenshots/{desktop,mobile,iphone,ipad}-screenshot.png
 * - docs/screenshots/{desktop,iphone,ipad}-inbound-modal.png
 * - docs/screenshots/graph-{desktop,desktop-focus,desktop-tilt}.png
 *
 * Raster library choice — jimp:
 *   The issue listed `sharp` as the preferred candidate, but sharp pulls in
 *   `@img/sharp-libvips-*` native binaries via its CJS loader, which Deno
 *   2.x only resolves when `nodeModulesDir: "auto"` is enabled. That would
 *   add a `node_modules/` directory to this otherwise pure-Deno repo —
 *   a regression the project's coding guidelines explicitly forbid.
 *
 *   Jimp is the next-preference candidate. It is pure JavaScript, has no
 *   native dependencies, runs cleanly under `--node-modules-dir=none`, and
 *   produces deterministic output given the same seed (verified locally).
 *
 * Usage (from repo root):
 *   deno run -A --node-modules-dir=none scripts/generate_pwa_assets.ts
 */

import { Jimp, ResizeStrategy } from "jimp";
import { chromium, type Page } from "playwright";
import { serveDir } from "@std/http/file-server";
import { fromFileUrl } from "@std/path";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const REPO_ROOT = fromFileUrl(new URL("..", import.meta.url));
const DOCS_DIR = `${REPO_ROOT}docs`;
const ICONS_DIR = `${DOCS_DIR}/icons`;
const SHOTS_DIR = `${DOCS_DIR}/screenshots`;

// Extra small sizes are used for traditional browser favicons (tabs/bookmarks).
const ICON_SIZES = [16, 32, 48, 72, 96, 128, 144, 152, 192, 384, 512] as const;
const BASE_SIZE = 1024;

// Default snapshot consumed by the app — pinned so README screenshots stay
// stable even if the in-app default changes in future.
const SNAPSHOT_URL =
  "https://stsoftwareau.github.io/NEAT-AI-Snapshot/snapshot.json.gz";

// Wait until the app's #status element flips to ok or warn. Identical to the
// Python original so success criteria stay aligned.
const STATUS_READY_PREDICATE = `(() => {
  const el = document.getElementById('status');
  if (!el) return false;
  return el.classList.contains('ok') || el.classList.contains('warn');
})()`;

// ---------------------------------------------------------------------------
// Deterministic PRNG (Mulberry32). Not bit-equivalent to Python's
// random.Random(1337) — the porting goal is "byte-stable between Deno runs",
// not "byte-equal to the Python output".
// ---------------------------------------------------------------------------

class SeededRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    let t = (this.state += 0x6d2b79f5) | 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Returns an integer in [min, max). Mirrors Python's randrange. */
  range(min: number, max: number): number {
    return Math.floor(this.next() * (max - min)) + min;
  }

  choice<T>(arr: readonly T[]): T {
    return arr[this.range(0, arr.length)];
  }
}

// ---------------------------------------------------------------------------
// RGBA pixel buffer + drawing primitives (port of the PIL ops used by the
// Python original). Working in a flat Uint8ClampedArray keeps everything
// deterministic and avoids per-pixel Jimp overhead.
// ---------------------------------------------------------------------------

type RGBA = readonly [number, number, number, number];

interface Pixels {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8ClampedArray;
}

function makePixels(w: number, h: number): Pixels {
  return { w, h, data: new Uint8ClampedArray(w * h * 4) };
}

/** Standard "source-over" alpha compositing on a single pixel. */
function blend(
  p: Pixels,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  a: number,
): void {
  if (x < 0 || y < 0 || x >= p.w || y >= p.h || a <= 0) return;
  const i = (y * p.w + x) * 4;
  const data = p.data;
  if (a >= 255 && data[i + 3] === 0) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
    return;
  }
  const sa = a / 255;
  const da = data[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa <= 0) return;
  data[i] = Math.round((r * sa + data[i] * da * (1 - sa)) / oa);
  data[i + 1] = Math.round((g * sa + data[i + 1] * da * (1 - sa)) / oa);
  data[i + 2] = Math.round((b * sa + data[i + 2] * da * (1 - sa)) / oa);
  data[i + 3] = Math.round(oa * 255);
}

/** Horizontal scanline fill (inclusive of x0..x1). */
function hLine(p: Pixels, x0: number, x1: number, y: number, c: RGBA): void {
  if (x0 > x1) [x0, x1] = [x1, x0];
  for (let x = x0; x <= x1; x++) blend(p, x, y, c[0], c[1], c[2], c[3]);
}

/** Filled axis-aligned ellipse inscribed in (x0,y0,x1,y1). */
function fillEllipse(
  p: Pixels,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  c: RGBA,
): void {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = Math.abs(x1 - x0) / 2;
  const ry = Math.abs(y1 - y0) / 2;
  if (rx <= 0 || ry <= 0) return;
  const yMin = Math.floor(cy - ry);
  const yMax = Math.ceil(cy + ry);
  for (let y = yMin; y <= yMax; y++) {
    const dy = (y - cy) / ry;
    const inside = 1 - dy * dy;
    if (inside <= 0) continue;
    const dx = rx * Math.sqrt(inside);
    hLine(p, Math.round(cx - dx), Math.round(cx + dx), y, c);
  }
}

/** Outline ellipse — drawn as a filled ring of width `w`. */
function outlineEllipse(
  p: Pixels,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  c: RGBA,
  w: number,
): void {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = Math.abs(x1 - x0) / 2;
  const ry = Math.abs(y1 - y0) / 2;
  if (rx <= 0 || ry <= 0) return;
  const halfW = w / 2;
  const yMin = Math.floor(cy - ry - halfW);
  const yMax = Math.ceil(cy + ry + halfW);
  for (let y = yMin; y <= yMax; y++) {
    const dy = y - cy;
    // Outer arc
    const inOuterX = 1 - (dy / (ry + halfW)) * (dy / (ry + halfW));
    if (inOuterX <= 0) continue;
    const outerDx = (rx + halfW) * Math.sqrt(inOuterX);
    // Inner arc (may not exist if dy is outside inner radius)
    const innerDenom = ry - halfW;
    let innerDx = -1;
    if (innerDenom > 0) {
      const innerInside = 1 - (dy / innerDenom) * (dy / innerDenom);
      if (innerInside > 0) innerDx = (rx - halfW) * Math.sqrt(innerInside);
    }
    if (innerDx <= 0) {
      hLine(p, Math.round(cx - outerDx), Math.round(cx + outerDx), y, c);
    } else {
      hLine(p, Math.round(cx - outerDx), Math.round(cx - innerDx), y, c);
      hLine(p, Math.round(cx + innerDx), Math.round(cx + outerDx), y, c);
    }
  }
}

/** Line of given width — stamps filled circles along a Bresenham path. */
function drawLine(
  p: Pixels,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  c: RGBA,
  width: number,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist === 0) {
    fillEllipse(
      p,
      x0 - width / 2,
      y0 - width / 2,
      x0 + width / 2,
      y0 + width / 2,
      c,
    );
    return;
  }
  const steps = Math.max(1, Math.ceil(dist));
  const r = Math.max(0.5, width / 2);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + dx * t;
    const y = y0 + dy * t;
    fillEllipse(p, x - r, y - r, x + r, y + r, c);
  }
}

/** Filled convex polygon via scanline rasterisation. */
function fillPolygon(
  p: Pixels,
  pts: readonly [number, number][],
  c: RGBA,
): void {
  if (pts.length < 3) return;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const [, y] of pts) {
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }
  yMin = Math.max(0, Math.floor(yMin));
  yMax = Math.min(p.h - 1, Math.ceil(yMax));
  for (let y = yMin; y <= yMax; y++) {
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % pts.length];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        const t = (y - y1) / (y2 - y1);
        xs.push(x1 + t * (x2 - x1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      hLine(p, Math.round(xs[i]), Math.round(xs[i + 1]), y, c);
    }
  }
}

// ---------------------------------------------------------------------------
// Icon composition — mirrors the Python design (deep-sea gradient, plankton,
// neural-net glow, lamp submersible, sonar rings).
// ---------------------------------------------------------------------------

const BG_TOP: RGBA = [10, 14, 26, 255];
const BG_BOTTOM: RGBA = [2, 6, 14, 255];
const ACCENT: RGBA = [96, 165, 250, 255];
const ACCENT2: RGBA = [45, 212, 191, 255];

function pixelsToJimpImage(p: Pixels) {
  // Jimp's RawImageData layout (bitmap.data) is a flat RGBA Buffer — we copy
  // our Uint8ClampedArray straight in. Two-step (construct → set) is required
  // because Jimp's constructor doesn't accept a raw pixel buffer.
  const img = new Jimp({ width: p.w, height: p.h, color: 0x00000000 });
  img.bitmap.data.set(p.data);
  return img;
}

function jimpToPixels(img: ReturnType<typeof pixelsToJimpImage>): Pixels {
  const w = img.bitmap.width;
  const h = img.bitmap.height;
  return { w, h, data: new Uint8ClampedArray(img.bitmap.data) };
}

/** Generate the 1024² source icon + a luminance "in-beam" mask. */
function generateIcon(): { img: Pixels; beamMask: Uint8ClampedArray } {
  const w = BASE_SIZE;
  const img = makePixels(w, w);
  const rng = new SeededRng(1337);

  // Background gradient (deep sea).
  for (let y = 0; y < w; y++) {
    const t = y / (w - 1);
    const r = Math.round(BG_TOP[0] * (1 - t) + BG_BOTTOM[0] * t);
    const g = Math.round(BG_TOP[1] * (1 - t) + BG_BOTTOM[1] * t);
    const b = Math.round(BG_TOP[2] * (1 - t) + BG_BOTTOM[2] * t);
    for (let x = 0; x < w; x++) blend(img, x, y, r, g, b, 255);
  }

  // Subtle "plankton" specks.
  const speckColours: RGBA[] = [ACCENT, ACCENT2, [229, 231, 235, 255]];
  for (let i = 0; i < 600; i++) {
    const x = rng.range(0, w);
    const y = rng.range(0, w);
    const a = rng.range(10, 45);
    const c = rng.choice(speckColours);
    blend(img, x, y, c[0], c[1], c[2], a);
  }

  // Explorer "lamp" origin + beam (discovery cone into the network).
  const lampX = Math.round(w * 0.28);
  const lampY = Math.round(w * 0.72);
  const beamTipX = Math.round(w * 0.74);
  const beamTipY = Math.round(w * 0.36);
  const nearW = Math.round(w * 0.08);
  const farW = Math.round(w * 0.42);

  const beamPoly: [number, number][] = [
    [lampX, lampY - Math.floor(nearW / 2)],
    [lampX, lampY + Math.floor(nearW / 2)],
    [beamTipX, beamTipY + Math.floor(farW / 2)],
    [beamTipX, beamTipY - Math.floor(farW / 2)],
  ];

  // Beam mask (L-channel) — blurred via Jimp so node brightness lookup
  // matches the Python original's GaussianBlur(radius ≈ 1.8% of base).
  const maskPixels = makePixels(w, w);
  fillPolygon(maskPixels, beamPoly, [255, 255, 255, 255]);
  const maskImg = pixelsToJimpImage(maskPixels);
  maskImg.blur(Math.max(1, Math.round(w * 0.018)));
  const blurredMask = jimpToPixels(maskImg);
  // Extract alpha (or red, since mask is greyscale white) into a flat array.
  const beamMask = new Uint8ClampedArray(w * w);
  for (let i = 0; i < beamMask.length; i++) {
    beamMask[i] = blurredMask.data[i * 4 + 3];
  }

  // Beam overlays — outer trapezoid + brighter inner cone.
  fillPolygon(img, beamPoly, [ACCENT2[0], ACCENT2[1], ACCENT2[2], 46]);
  fillPolygon(img, [
    [lampX, lampY - Math.floor(nearW * 0.35)],
    [lampX, lampY + Math.floor(nearW * 0.35)],
    [beamTipX, beamTipY + Math.floor(farW * 0.30)],
    [beamTipX, beamTipY - Math.floor(farW * 0.30)],
  ], [ACCENT[0], ACCENT[1], ACCENT[2], 62]);

  // "Neural net depths": nodes + edges, brighter within the beam.
  const nodes: [number, number][] = [];
  for (let i = 0; i < 34; i++) {
    const x = Math.round(w * (0.26 + 0.66 * rng.next()));
    const y = Math.round(w * (0.18 + 0.68 * rng.next()));
    nodes.push([x, y]);
  }

  const nodeBrightness = (x: number, y: number): number => {
    const depth = y / (w - 1);
    const xi = Math.max(0, Math.min(w - 1, x));
    const yi = Math.max(0, Math.min(w - 1, y));
    const inBeam = beamMask[yi * w + xi] / 255;
    return Math.max(
      0,
      Math.min(1, (0.22 + 0.65 * inBeam) * (1 - 0.35 * depth)),
    );
  };

  // Edges: each node links to its two nearest neighbours.
  const edgeWidth = Math.max(1, Math.round(w * 0.006));
  for (let i = 0; i < nodes.length; i++) {
    const [x1, y1] = nodes[i];
    const dists: { d2: number; j: number }[] = [];
    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue;
      const [x2, y2] = nodes[j];
      const dx = x2 - x1;
      const dy = y2 - y1;
      dists.push({ d2: dx * dx + dy * dy, j });
    }
    dists.sort((a, b) => a.d2 - b.d2);
    for (let k = 0; k < Math.min(2, dists.length); k++) {
      const [x2, y2] = nodes[dists[k].j];
      const b = (nodeBrightness(x1, y1) + nodeBrightness(x2, y2)) / 2;
      const a = Math.round(20 + 140 * b);
      const col: RGBA = [
        Math.round(ACCENT[0] * b + 229 * (1 - b)),
        Math.round(ACCENT2[1] * b + 231 * (1 - b)),
        Math.round(ACCENT[2] * b + 235 * (1 - b)),
        a,
      ];
      drawLine(img, x1, y1, x2, y2, col, edgeWidth);
    }
  }

  // Nodes on top.
  for (const [x, y] of nodes) {
    const b = nodeBrightness(x, y);
    const r = Math.round(w * (0.012 + 0.010 * b));
    const fill: RGBA = [
      Math.round(ACCENT2[0] * b + 90 * (1 - b)),
      Math.round(ACCENT2[1] * b + 120 * (1 - b)),
      Math.round(ACCENT[2] * b + 150 * (1 - b)),
      Math.round(110 + 145 * b),
    ];
    fillEllipse(img, x - r, y - r, x + r, y + r, fill);
  }

  // Lamp "submersible" silhouette.
  const hullR = Math.round(w * 0.055);
  const hullOutlineW = Math.max(1, Math.round(w * 0.004));
  fillEllipse(img, lampX - hullR, lampY - hullR, lampX + hullR, lampY + hullR, [
    17,
    24,
    39,
    240,
  ]);
  outlineEllipse(
    img,
    lampX - hullR,
    lampY - hullR,
    lampX + hullR,
    lampY + hullR,
    [255, 255, 255, 18],
    hullOutlineW,
  );

  // Lamp glow.
  const glowR = Math.round(w * 0.030);
  fillEllipse(img, lampX - glowR, lampY - glowR, lampX + glowR, lampY + glowR, [
    ACCENT2[0],
    ACCENT2[1],
    ACCENT2[2],
    210,
  ]);

  // Sonar rings.
  const ringW = Math.max(1, Math.round(w * 0.004));
  for (let k = 1; k < 4; k++) {
    const rr = Math.round(hullR * (1.25 + 0.55 * k));
    const aa = Math.max(0, 70 - 14 * k);
    outlineEllipse(img, lampX - rr, lampY - rr, lampX + rr, lampY + rr, [
      ACCENT[0],
      ACCENT[1],
      ACCENT[2],
      aa,
    ], ringW);
  }

  return { img, beamMask };
}

// ---------------------------------------------------------------------------
// ICO encoder — sharp/jimp don't write .ico, so we splice PNG payloads into
// a tiny custom container. Format: Wikipedia "ICO (file format)".
// ---------------------------------------------------------------------------

function encodeIco(
  images: { width: number; height: number; png: Uint8Array }[],
): Uint8Array {
  const headerSize = 6;
  const entrySize = 16;
  const dirSize = headerSize + entrySize * images.length;
  let totalDataSize = 0;
  for (const img of images) totalDataSize += img.png.byteLength;
  const out = new Uint8Array(dirSize + totalDataSize);
  const dv = new DataView(out.buffer);

  // ICONDIR header
  dv.setUint16(0, 0, true); // reserved
  dv.setUint16(2, 1, true); // type = 1 (icon)
  dv.setUint16(4, images.length, true);

  let offset = dirSize;
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const e = headerSize + i * entrySize;
    dv.setUint8(e + 0, img.width >= 256 ? 0 : img.width);
    dv.setUint8(e + 1, img.height >= 256 ? 0 : img.height);
    dv.setUint8(e + 2, 0); // colour palette
    dv.setUint8(e + 3, 0); // reserved
    dv.setUint16(e + 4, 1, true); // colour planes
    dv.setUint16(e + 6, 32, true); // bits per pixel
    dv.setUint32(e + 8, img.png.byteLength, true);
    dv.setUint32(e + 12, offset, true);
    out.set(img.png, offset);
    offset += img.png.byteLength;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Icon rendering — write source + every ICON_SIZES + multi-res favicon.
// ---------------------------------------------------------------------------

async function writePng(
  img: ReturnType<typeof pixelsToJimpImage>,
  path: string,
): Promise<void> {
  const buf = await img.getBuffer("image/png");
  await Deno.writeFile(path, new Uint8Array(buf));
}

async function renderIcons(): Promise<void> {
  await Deno.mkdir(ICONS_DIR, { recursive: true });

  const { img: sourcePixels } = generateIcon();
  const sourceImg = pixelsToJimpImage(sourcePixels);

  // Source PNG at full base size.
  await writePng(sourceImg, `${ICONS_DIR}/icon-source.png`);

  // Resized icons (BICUBIC — Jimp 1.x's best-quality option short of Lanczos).
  for (const size of ICON_SIZES) {
    const resized = sourceImg.clone();
    resized.resize({ w: size, h: size, mode: ResizeStrategy.BICUBIC });
    await writePng(resized, `${ICONS_DIR}/icon-${size}x${size}.png`);
  }

  // Multi-resolution favicon (16/32/48). Re-encode at each size for sharpness.
  const faviconSizes = [16, 32, 48];
  const faviconImages: { width: number; height: number; png: Uint8Array }[] =
    [];
  for (const size of faviconSizes) {
    const resized = sourceImg.clone();
    resized.resize({ w: size, h: size, mode: ResizeStrategy.BICUBIC });
    const buf = await resized.getBuffer("image/png");
    faviconImages.push({ width: size, height: size, png: new Uint8Array(buf) });
  }
  const ico = encodeIco(faviconImages);
  await Deno.writeFile(`${DOCS_DIR}/favicon.ico`, ico);
}

// ---------------------------------------------------------------------------
// Screenshot capture — Playwright against a local docs/ file-server.
// ---------------------------------------------------------------------------

interface ServerHandle {
  url: string;
  shutdown: () => Promise<void>;
}

function startDocsServer(): ServerHandle {
  // Bind to ephemeral port (0) so concurrent runs don't collide.
  const controller = new AbortController();
  const server = Deno.serve(
    {
      port: 0,
      hostname: "127.0.0.1",
      signal: controller.signal,
      onListen: () => {/* suppress default banner */},
    },
    (req) => serveDir(req, { fsRoot: DOCS_DIR, quiet: true }),
  );
  const addr = server.addr as Deno.NetAddr;
  return {
    url: `http://127.0.0.1:${addr.port}/`,
    shutdown: async () => {
      controller.abort();
      try {
        await server.finished;
      } catch (_) { /* aborted */ }
    },
  };
}

async function loadApp(
  page: Page,
  serverUrl: string,
  label: string,
): Promise<void> {
  const target = `${serverUrl}?snapshotUrl=${encodeURIComponent(SNAPSHOT_URL)}`;
  await page.goto(target, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(STATUS_READY_PREDICATE, undefined, {
    timeout: 180_000,
  });
  await page.waitForTimeout(250);
  try {
    const overflow = await page.evaluate(
      "() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2",
    );
    if (overflow) {
      console.warn(`Warning: horizontal overflow detected in ${label}`);
    }
  } catch (_) { /* best-effort */ }
}

async function openInboundModal(page: Page): Promise<void> {
  await page.click(".impactBreakdownBtn");
  await page.waitForSelector("#pathModal.isOpen", { timeout: 10_000 });
  await page.waitForTimeout(150);
}

async function loadGraph(
  page: Page,
  serverUrl: string,
  label: string,
): Promise<void> {
  await page.goto(`${serverUrl}graph/`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(STATUS_READY_PREDICATE, undefined, {
    timeout: 180_000,
  });
  await page.waitForTimeout(400);
  try {
    const overflow = await page.evaluate(
      "() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2",
    );
    if (overflow) {
      console.warn(`Warning: horizontal overflow detected in ${label} (graph)`);
    }
  } catch (_) { /* best-effort */ }
}

async function captureScreenshots(): Promise<void> {
  await Deno.mkdir(SHOTS_DIR, { recursive: true });

  const server = startDocsServer();
  const browser = await chromium.launch();
  try {
    // Desktop (manifest + inbound modal variant)
    const desktopCtx = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    const desktopPage = await desktopCtx.newPage();
    await loadApp(desktopPage, server.url, "Desktop");
    await desktopPage.screenshot({
      path: `${SHOTS_DIR}/desktop-screenshot.png`,
      fullPage: true,
    });
    await openInboundModal(desktopPage);
    await desktopPage.screenshot({
      path: `${SHOTS_DIR}/desktop-inbound-modal.png`,
      fullPage: true,
    });
    await desktopCtx.close();

    // Mobile (manifest)
    const mobileCtx = await browser.newContext({
      viewport: { width: 720, height: 1280 },
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    });
    const mobilePage = await mobileCtx.newPage();
    await loadApp(mobilePage, server.url, "Mobile");
    await mobilePage.screenshot({
      path: `${SHOTS_DIR}/mobile-screenshot.png`,
      fullPage: true,
    });
    await mobileCtx.close();

    // iPhone (README)
    const iphoneCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    });
    const iphonePage = await iphoneCtx.newPage();
    await loadApp(iphonePage, server.url, "iPhone");
    await iphonePage.screenshot({
      path: `${SHOTS_DIR}/iphone-screenshot.png`,
      fullPage: true,
    });
    await openInboundModal(iphonePage);
    await iphonePage.screenshot({
      path: `${SHOTS_DIR}/iphone-inbound-modal.png`,
      fullPage: true,
    });
    await iphoneCtx.close();

    // iPad (README)
    const ipadCtx = await browser.newContext({
      viewport: { width: 820, height: 1180 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      userAgent:
        "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    });
    const ipadPage = await ipadCtx.newPage();
    await loadApp(ipadPage, server.url, "iPad");
    await ipadPage.screenshot({
      path: `${SHOTS_DIR}/ipad-screenshot.png`,
      fullPage: true,
    });
    await openInboundModal(ipadPage);
    await ipadPage.screenshot({
      path: `${SHOTS_DIR}/ipad-inbound-modal.png`,
      fullPage: true,
    });
    await ipadCtx.close();

    // Graph (README) — three desktop shots.
    const graphCtx = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    const graphPage = await graphCtx.newPage();
    await loadGraph(graphPage, server.url, "Desktop (graph)");
    await graphPage.screenshot({
      path: `${SHOTS_DIR}/graph-desktop.png`,
      fullPage: true,
    });

    // Focus HUD — click centre to focus a neuron.
    try {
      await graphPage.mouse.click(640, 360);
      await graphPage.waitForTimeout(250);
    } catch (_) { /* best-effort */ }
    await graphPage.screenshot({
      path: `${SHOTS_DIR}/graph-desktop-focus.png`,
      fullPage: true,
    });

    // Tilt — drag to tilt the camera.
    try {
      await graphPage.mouse.move(640, 360);
      await graphPage.mouse.down();
      await graphPage.mouse.move(740, 300);
      await graphPage.mouse.up();
      await graphPage.waitForTimeout(200);
    } catch (_) { /* best-effort */ }
    await graphPage.screenshot({
      path: `${SHOTS_DIR}/graph-desktop-tilt.png`,
      fullPage: true,
    });
    await graphCtx.close();
  } finally {
    await browser.close();
    await server.shutdown();
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  try {
    await Deno.stat(DOCS_DIR);
  } catch {
    console.error(`docs/ folder not found at ${DOCS_DIR}`);
    return 1;
  }

  console.log("Rendering icons + favicon...");
  await renderIcons();

  console.log("Capturing screenshots (Playwright)...");
  await captureScreenshots();

  console.log("Done.");
  return 0;
}

if (import.meta.main) {
  Deno.exit(await main());
}
