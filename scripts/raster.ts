/**
 * Minimal pure-Deno raster helpers for scripts/generate_pwa_assets.ts.
 *
 * Replaces `npm:jimp`, whose only supported zod range (^3) is affected by
 * GHSA-mrhx-c7xc-m3w5 with no patched 3.x release. Only what the asset
 * generator needs is implemented: a box blur, a bicubic resize and a PNG
 * encoder. Pixels are flat RGBA, 4 bytes per pixel.
 */

export interface Raster {
  w: number;
  h: number;
  data: Uint8ClampedArray;
}

/** Separable box blur with edge clamping; window is `2 * radius + 1` wide. */
export function boxBlur(src: Raster, radius: number): Raster {
  if (!Number.isInteger(radius) || radius < 0) {
    throw new RangeError(
      `blur radius must be a non-negative integer: ${radius}`,
    );
  }
  const { w, h } = src;
  const horizontal = blurPass(src.data, w, h, radius, true);
  const data = blurPass(horizontal, w, h, radius, false);
  return { w, h, data };
}

function blurPass(
  input: Uint8ClampedArray,
  w: number,
  h: number,
  radius: number,
  horizontal: boolean,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(input.length);
  const lines = horizontal ? h : w;
  const length = horizontal ? w : h;
  const stride = horizontal ? 4 : w * 4;
  const lineStep = horizontal ? w * 4 : 4;
  const window = 2 * radius + 1;
  for (let line = 0; line < lines; line++) {
    const base = line * lineStep;
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const i = Math.min(length - 1, Math.max(0, k));
        sum += input[base + i * stride + c];
      }
      for (let i = 0; i < length; i++) {
        out[base + i * stride + c] = Math.round(sum / window);
        const add = Math.min(length - 1, i + radius + 1);
        const drop = Math.max(0, i - radius);
        sum += input[base + add * stride + c] - input[base + drop * stride + c];
      }
    }
  }
  return out;
}

// Catmull-Rom cubic kernel (Keys, a = -0.5).
function cubic(x: number): number {
  const a = Math.abs(x);
  if (a < 1) return 1.5 * a * a * a - 2.5 * a * a + 1;
  if (a < 2) return -0.5 * a * a * a + 2.5 * a * a - 4 * a + 2;
  return 0;
}

/** Bicubic resize; the kernel widens when shrinking so it low-pass filters. */
export function resizeBicubic(src: Raster, w: number, h: number): Raster {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) {
    throw new RangeError(`invalid resize target: ${w}x${h}`);
  }
  const across = resizeAxis(src.data, src.w, src.h, w, true);
  const data = resizeAxis(across, w, src.h, h, false);
  return { w, h, data };
}

function resizeAxis(
  input: Uint8ClampedArray,
  w: number,
  h: number,
  target: number,
  horizontal: boolean,
): Uint8ClampedArray {
  const length = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const outW = horizontal ? target : w;
  const outH = horizontal ? h : target;
  const out = new Uint8ClampedArray(outW * outH * 4);
  const scale = length / target;
  const support = Math.max(1, scale) * 2;
  const filterScale = Math.max(1, scale);
  for (let o = 0; o < target; o++) {
    const centre = (o + 0.5) * scale - 0.5;
    const first = Math.floor(centre - support) + 1;
    const last = Math.floor(centre + support);
    const taps: { i: number; wt: number }[] = [];
    let total = 0;
    for (let s = first; s <= last; s++) {
      const wt = cubic((s - centre) / filterScale);
      if (wt === 0) continue;
      taps.push({ i: Math.min(length - 1, Math.max(0, s)), wt });
      total += wt;
    }
    for (let line = 0; line < lines; line++) {
      for (let c = 0; c < 4; c++) {
        let acc = 0;
        for (const t of taps) {
          const idx = horizontal
            ? (line * w + t.i) * 4 + c
            : (t.i * w + line) * 4 + c;
          acc += input[idx] * t.wt;
        }
        const oIdx = horizontal
          ? (line * outW + o) * 4 + c
          : (o * outW + line) * 4 + c;
        out[oIdx] = Math.round(acc / total);
      }
    }
  }
  return out;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  dv.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

async function zlibDeflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(
    new CompressionStream("deflate"),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Encode an 8-bit RGBA raster as a PNG (filter 0, zlib via CompressionStream). */
export async function encodePng(img: Raster): Promise<Uint8Array> {
  const { w, h, data } = img;
  if (data.length !== w * h * 4) {
    throw new RangeError(
      `pixel buffer is ${data.length} bytes, expected ${
        w * h * 4
      } for ${w}x${h}`,
    );
  }
  const rowBytes = w * 4;
  const raw = new Uint8Array(h * (rowBytes + 1));
  for (let y = 0; y < h; y++) {
    raw.set(
      data.subarray(y * rowBytes, (y + 1) * rowBytes),
      y * (rowBytes + 1) + 1,
    );
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", await zlibDeflate(raw)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
