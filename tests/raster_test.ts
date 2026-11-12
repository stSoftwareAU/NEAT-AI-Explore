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

Deno.test("boxBlur blurs both axes of a 2-D image", () => {
  const img = solid(3, 3, 0);
  img.data[(1 * 3 + 1) * 4] = 90; // red channel of the centre pixel
  const red = [...boxBlur(img, 1).data].filter((_, i) => i % 4 === 0);
  assertDeepEquals(red, [10, 10, 10, 10, 10, 10, 10, 10, 10]);
});

Deno.test("resizeBicubic resamples a 2-D gradient on each axis", () => {
  const img = solid(8, 4, 0);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 8; x++) {
      const i = (y * 8 + x) * 4;
      img.data[i] = x * 32;
      img.data[i + 1] = y * 64;
    }
  }
  const out = resizeBicubic(img, 4, 2);
  assertDeepEquals([out.w, out.h], [4, 2]);
  const px = (x: number, y: number, c: number) => out.data[(y * 4 + x) * 4 + c];
  for (let y = 0; y < 2; y++) {
    assertDeepEquals([0, 1, 2, 3].map((x) => px(x, y, 0)), [16, 80, 144, 208]);
    for (let x = 0; x < 4; x++) assertEquals(px(x, y, 1), y === 0 ? 33 : 159);
  }
});

Deno.test("encodePng output decodes through the platform decoder", async () => {
  const img = solid(3, 2, 0);
  img.data.set([
    255,
    0,
    0,
    255,
    0,
    255,
    0,
    128,
    0,
    0,
    255,
    255,
    10,
    20,
    30,
    40,
    50,
    60,
    70,
    80,
    90,
    100,
    110,
    120,
  ]);
  const png = await encodePng(img);
  assertDeepEquals([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const dv = new DataView(png.buffer, png.byteOffset);
  // IHDR: width/height at 16..24, then bit depth 8, RGBA (6), deflate, filter 0, no interlace.
  assertDeepEquals([dv.getUint32(16), dv.getUint32(20)], [3, 2]);
  assertDeepEquals([...png.subarray(24, 29)], [8, 6, 0, 0, 0]);
  // createImageBitmap verifies chunk CRCs, so a wrong crc32 is rejected here.
  const bmp = await createImageBitmap(
    new Blob([png as BlobPart], { type: "image/png" }),
  );
  assertDeepEquals([bmp.width, bmp.height], [3, 2]);
  bmp.close();
  // Decode the IDAT payload and compare both scanlines (filter byte 0 each).
  const idatLen = dv.getUint32(33);
  const z = png.subarray(41, 41 + idatLen);
  const raw = new Uint8Array(
    await new Response(
      new Blob([z as BlobPart]).stream().pipeThrough(
        new DecompressionStream("deflate"),
      ),
    ).arrayBuffer(),
  );
  assertEquals(raw.length, 2 * (3 * 4 + 1));
  assertEquals(raw[0], 0);
  assertDeepEquals([...raw.subarray(1, 13)], [...img.data.subarray(0, 12)]);
  assertEquals(raw[13], 0);
  assertDeepEquals([...raw.subarray(14, 26)], [...img.data.subarray(12, 24)]);
});

Deno.test("encodePng output with a corrupted IHDR CRC is rejected by the decoder", async () => {
  const png = await encodePng(solid(3, 2, 7));
  png[32] ^= 0xff; // last IHDR CRC byte
  let threw = false;
  try {
    await createImageBitmap(new Blob([png as BlobPart], { type: "image/png" }));
  } catch {
    threw = true;
  }
  assert(threw, "decoder should reject a bad CRC (positive control)");
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
