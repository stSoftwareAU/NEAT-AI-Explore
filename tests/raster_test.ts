import { assert } from "./test_helpers.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  assert(a === b, `expected ${b} but got ${a}`);
}
import {
  blur,
  encodePng,
  type Pixels,
  resizeBicubic,
} from "../scripts/raster.ts";

function solid(w: number, h: number, rgba: number[]): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(rgba, i * 4);
  return { w, h, data };
}

Deno.test("resizeBicubic keeps a solid colour solid", () => {
  const out = resizeBicubic(solid(64, 64, [10, 100, 200, 255]), 16, 16);
  assertEquals([out.w, out.h], [16, 16]);
  for (let i = 0; i < 16 * 16; i++) {
    assertEquals(Array.from(out.data.subarray(i * 4, i * 4 + 4)), [
      10,
      100,
      200,
      255,
    ]);
  }
});

Deno.test("resizeBicubic does not bleed colour from transparent pixels", () => {
  const src = solid(8, 8, [0, 0, 0, 0]);
  src.data.set([255, 0, 0, 255], 0);
  const out = resizeBicubic(src, 4, 4);
  for (let i = 0; i < 16; i++) {
    if (out.data[i * 4 + 3] > 0) assertEquals(out.data[i * 4 + 1], 0);
  }
});

Deno.test("resizeBicubic rejects an invalid target", () => {
  let threw = false;
  try {
    resizeBicubic(solid(4, 4, [0, 0, 0, 255]), 0, 4);
  } catch (e) {
    threw = e instanceof RangeError;
  }
  assert(threw, "expected RangeError");
});

Deno.test("blur spreads a white square outward and preserves flat areas", () => {
  const flat = blur(solid(9, 9, [255, 255, 255, 255]), 2);
  assertEquals(Array.from(flat.data.subarray(0, 4)), [255, 255, 255, 255]);
  const src = solid(21, 21, [0, 0, 0, 0]);
  src.data.set([255, 255, 255, 255], (10 * 21 + 10) * 4);
  const out = blur(src, 2);
  assert(out.data[(10 * 21 + 10) * 4 + 3] < 255);
  assert(out.data[(10 * 21 + 12) * 4 + 3] > 0);
});

Deno.test("encodePng emits a valid RGBA PNG that decodes to the input", async () => {
  const src = solid(3, 2, [1, 2, 3, 4]);
  src.data.set([250, 251, 252, 253], 4);
  const png = await encodePng(src);
  assertEquals(Array.from(png.subarray(0, 8)), [
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
  ]);
  const view = new DataView(png.buffer, png.byteOffset);
  assertEquals([view.getUint32(16), view.getUint32(20), png[24], png[25]], [
    3,
    2,
    8,
    6,
  ]);
  // IDAT payload starts after sig(8)+IHDR(25)+len/type(8).
  const idatLen = view.getUint32(33);
  const idat = png.subarray(41, 41 + idatLen);
  const raw = new Uint8Array(
    await new Response(
      new Blob([new Uint8Array(idat)]).stream().pipeThrough(
        new DecompressionStream("deflate"),
      ),
    ).arrayBuffer(),
  );
  assertEquals(raw.length, (3 * 4 + 1) * 2);
  assertEquals(Array.from(raw.subarray(1, 9)), [
    1,
    2,
    3,
    4,
    250,
    251,
    252,
    253,
  ]);
  assertEquals(Array.from(png.subarray(png.length - 8, png.length - 4)), [
    0x49,
    0x45,
    0x4e,
    0x44,
  ]);
});
