/**
 * Tests for the pure scaling helpers (issue #238).
 */

import { logScalePixels } from "../docs/shared/scale.js";
import { approx, assert, assertEquals } from "./test_helpers.ts";

Deno.test("logScalePixels: value=0 returns minPx", () => {
  assertEquals(logScalePixels(0, 100, 4, 20), 4);
});

Deno.test("logScalePixels: value=maxValue returns maxPx", () => {
  approx(logScalePixels(100, 100, 4, 20), 20);
});

Deno.test("logScalePixels: monotonic between min and max", () => {
  const a = logScalePixels(1, 100, 4, 20);
  const b = logScalePixels(10, 100, 4, 20);
  const c = logScalePixels(50, 100, 4, 20);
  const d = logScalePixels(100, 100, 4, 20);
  assert(a < b, `expected a(${a}) < b(${b})`);
  assert(b < c, `expected b(${b}) < c(${c})`);
  assert(c < d, `expected c(${c}) < d(${d})`);
  // And all between minPx and maxPx.
  for (const v of [a, b, c, d]) {
    assert(v >= 4 && v <= 20, `out of range: ${v}`);
  }
});

Deno.test("logScalePixels: log compression — small values still visible", () => {
  // ln(2)/ln(101) ≈ 0.15 → pixel ≈ 4 + 16*0.15 ≈ 6.4
  const px = logScalePixels(1, 100, 4, 20);
  assert(px > 4, "value=1 should produce a pixel above minPx");
  // It should be well below the linear midpoint, demonstrating log compression
  // is making small values relatively larger than they would be linearly.
  assert(
    px > 4 + (20 - 4) * (1 / 100),
    `log scale should lift value=1 above its linear share, got ${px}`,
  );
});

Deno.test("logScalePixels: negative value returns minPx", () => {
  assertEquals(logScalePixels(-5, 100, 4, 20), 4);
});

Deno.test("logScalePixels: zero maxValue returns minPx", () => {
  assertEquals(logScalePixels(50, 0, 4, 20), 4);
});

Deno.test("logScalePixels: negative maxValue returns minPx", () => {
  assertEquals(logScalePixels(50, -10, 4, 20), 4);
});

Deno.test("logScalePixels: NaN value returns minPx without throwing", () => {
  assertEquals(logScalePixels(NaN, 100, 4, 20), 4);
});

Deno.test("logScalePixels: NaN maxValue returns minPx without throwing", () => {
  assertEquals(logScalePixels(10, NaN, 4, 20), 4);
});

Deno.test("logScalePixels: clamps to [minPx, maxPx]", () => {
  // Above maxValue still clamps to maxPx.
  const px = logScalePixels(1000, 100, 4, 20);
  assert(px <= 20, `expected clamp ≤ 20, got ${px}`);
  assert(px >= 4, `expected clamp ≥ 4, got ${px}`);
});
