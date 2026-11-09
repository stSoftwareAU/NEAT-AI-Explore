/**
 * Minimal dependency-free RGBA raster helpers for scripts/generate_pwa_assets.ts:
 * box blur, bicubic resize and PNG encoding. Replaces npm:jimp, whose transitive
 * zod@3 is flagged by GHSA-mrhx-c7xc-m3w5 with no patched release in range.
 */

export interface Pixels {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8ClampedArray;
}

/** Three successive box blurs of the given radius (close to a Gaussian). */
export function blur(src: Pixels, radius: number): Pixels {
  if (!Number.isInteger(radius) || radius < 0) {
    throw new RangeError(
      `blur radius must be a non-negative integer: ${radius}`,
    );
  }
  let cur: Float32Array = Float32Array.from(src.data);
  for (let pass = 0; pass < 3; pass++) {
    cur = boxPass(cur, src.w, src.h, radius, true);
    cur = boxPass(cur, src.w, src.h, radius, false);
  }
  return { w: src.w, h: src.h, data: new Uint8ClampedArray(cur) };
}

function boxPass(
  src: Float32Array,
  w: number,
  h: number,
  radius: number,
  horizontal: boolean,
): Float32Array {
  const out = new Float32Array(src.length);
  const len = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const step = horizontal ? 4 : w * 4;
  const lineStep = horizontal ? w * 4 : 4;
  const span = radius * 2 + 1;
  for (let line = 0; line < lines; line++) {
    const base = line * lineStep;
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let i = -radius; i <= radius; i++) {
        const j = Math.min(len - 1, Math.max(0, i));
        sum += src[base + j * step + c];
      }
      for (let i = 0; i < len; i++) {
        out[base + i * step + c] = sum / span;
        const add = Math.min(len - 1, i + radius + 1);
        const sub = Math.max(0, i - radius);
        sum += src[base + add * step + c] - src[base + sub * step + c];
      }
    }
  }
  return out;
}

/** Catmull-Rom cubic kernel (the standard "bicubic" with a = -0.5). */
function cubic(x: number): number {
  const a = Math.abs(x);
  if (a < 1) return 1.5 * a ** 3 - 2.5 * a ** 2 + 1;
  if (a < 2) return -0.5 * a ** 3 + 2.5 * a ** 2 - 4 * a + 2;
  return 0;
}

/** Per-output-pixel [firstSource, weights] with the kernel widened on downscale. */
function weightsFor(inSize: number, outSize: number) {
  const scale = inSize / outSize;
  const filterScale = Math.max(1, scale);
  const support = 2 * filterScale;
  const table: { first: number; weights: Float64Array }[] = [];
  for (let o = 0; o < outSize; o++) {
    const centre = (o + 0.5) * scale;
    const first = Math.max(0, Math.floor(centre - support));
    const last = Math.min(inSize - 1, Math.ceil(centre + support) - 1);
    const weights = new Float64Array(last - first + 1);
    let total = 0;
    for (let i = first; i <= last; i++) {
      const wt = cubic((i + 0.5 - centre) / filterScale);
      weights[i - first] = wt;
      total += wt;
    }
    for (let i = 0; i < weights.length; i++) weights[i] /= total;
    table.push({ first, weights });
  }
  return table;
}

/** Bicubic resize on premultiplied alpha, so transparent edges do not bleed. */
export function resizeBicubic(src: Pixels, w: number, h: number): Pixels {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) {
    throw new RangeError(`invalid resize target: ${w}x${h}`);
  }
  const pre = new Float32Array(src.w * src.h * 4);
  for (let i = 0; i < src.w * src.h; i++) {
    const a = src.data[i * 4 + 3] / 255;
    pre[i * 4] = src.data[i * 4] * a;
    pre[i * 4 + 1] = src.data[i * 4 + 1] * a;
    pre[i * 4 + 2] = src.data[i * 4 + 2] * a;
    pre[i * 4 + 3] = src.data[i * 4 + 3];
  }
  const xw = weightsFor(src.w, w);
  const yw = weightsFor(src.h, h);
  // Horizontal pass: src.w x src.h -> w x src.h.
  const mid = new Float32Array(w * src.h * 4);
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < w; x++) {
      const { first, weights } = xw[x];
      for (let c = 0; c < 4; c++) {
        let acc = 0;
        for (let k = 0; k < weights.length; k++) {
          acc += pre[(y * src.w + first + k) * 4 + c] * weights[k];
        }
        mid[(y * w + x) * 4 + c] = acc;
      }
    }
  }
  // Vertical pass: w x src.h -> w x h, then un-premultiply.
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const { first, weights } = yw[y];
    for (let x = 0; x < w; x++) {
      const acc = [0, 0, 0, 0];
      for (let k = 0; k < weights.length; k++) {
        for (let c = 0; c < 4; c++) {
          acc[c] += mid[((first + k) * w + x) * 4 + c] * weights[k];
        }
      }
      const alpha = Math.min(255, Math.max(0, acc[3]));
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        out[o + c] = alpha > 0 ? (acc[c] * 255) / alpha : 0;
      }
      out[o + 3] = alpha;
    }
  }
  return { w, h, data: out };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + payload.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, payload.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(payload, 8);
  view.setUint32(
    8 + payload.length,
    crc32(out.subarray(4, 8 + payload.length)),
  );
  return out;
}

/** Encodes an 8-bit RGBA PNG (zlib via the platform CompressionStream). */
export async function encodePng(p: Pixels): Promise<Uint8Array> {
  const stride = p.w * 4;
  const raw = new Uint8Array((stride + 1) * p.h); // filter byte 0 per scanline
  for (let y = 0; y < p.h; y++) {
    raw.set(
      p.data.subarray(y * stride, (y + 1) * stride),
      y * (stride + 1) + 1,
    );
  }
  const compressed = new Uint8Array(
    await new Response(
      new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate")),
    ).arrayBuffer(),
  );
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, p.w);
  view.setUint32(4, p.h);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, a) => n + a.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
