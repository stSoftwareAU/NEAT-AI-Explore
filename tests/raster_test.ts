/** Contract tests for scripts/raster.ts (the jimp replacement). */

import { assert, assertEquals } from "./test_helpers.ts";
import { boxBlur, encodePng, resizeBicubic } from "../scripts/raster.ts";

function assertDeepEquals(actual: unknown, expected: unknown): void {
  assertEquals(JSON.stringify(actual), JSON.stringify(expected));
}

function solid(w: number, h: number, v: number) {
  return { w, h, data: new Uint8ClampedArray(w * h * 4).fill(v) };
}

Deno.test("boxBlur leaves a flat image unchanged", () => {
  assertDeepEquals(boxBlur(solid(8, 6, 200), 2).data, solid(8, 6, 200).data);
});

Deno.test("boxBlur spreads a single bright pixel evenly over its window", () => {
  const img = solid(9, 1, 0);
  img.data[4 * 4] = 90; // red channel of the centre pixel
  const out = boxBlur(img, 1);
  const red = [...out.data].filter((_, i) => i % 4 === 0);
  assertDeepEquals(red, [0, 0, 0, 30, 30, 30, 0, 0, 0]);
});

Deno.test("boxBlur rejects a negative or fractional radius", () => {
  for (const r of [-1, 1.5]) {
    let threw = false;
    try {
      boxBlur(solid(2, 2, 0), r);
    } catch (e) {
      threw = e instanceof RangeError;
    }
    assert(threw, `radius ${r} should throw RangeError`);
  }
});

Deno.test("resizeBicubic keeps a flat colour and hits the target size", () => {
  const out = resizeBicubic(solid(64, 64, 123), 16, 16);
  assertDeepEquals([out.w, out.h, out.data.length], [16, 16, 16 * 16 * 4]);
  assert(out.data.every((v) => v === 123));
});

Deno.test("resizeBicubic rejects a zero-sized target", () => {
  let threw = false;
  try {
    resizeBicubic(solid(4, 4, 0), 0, 4);
  } catch (e) {
    threw = e instanceof RangeError;
  }
  assert(threw);
});

Deno.test("encodePng round-trips through the platform decoder", async () => {
  const img = solid(3, 2, 0);
  img.data.set([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 255]);
  const png = await encodePng(img);
  assertDeepEquals([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  // IHDR width/height live at bytes 16..24 (big-endian).
  const dv = new DataView(png.buffer, png.byteOffset);
  assertDeepEquals([dv.getUint32(16), dv.getUint32(20)], [3, 2]);
  // Decode the IDAT payload back and compare scanlines.
  const idatStart = 33 + 8;
  const idatLen = dv.getUint32(33);
  const z = png.subarray(idatStart, idatStart + idatLen);
  const raw = new Uint8Array(
    await new Response(
      new Blob([z as BlobPart]).stream().pipeThrough(
        new DecompressionStream("deflate"),
      ),
    ).arrayBuffer(),
  );
  assertEquals(raw.length, 2 * (3 * 4 + 1));
  assertDeepEquals([...raw.subarray(1, 13)], [...img.data.subarray(0, 12)]);
  assertEquals(raw[0], 0);
});

Deno.test("encodePng rejects a buffer that does not match the size", async () => {
  let threw = false;
  try {
    await encodePng({ w: 2, h: 2, data: new Uint8ClampedArray(4) });
  } catch (e) {
    threw = e instanceof RangeError;
  }
  assert(threw);
});
