import { approx, assert, assertEquals } from "./test_helpers.ts";

import {
  hash32,
  neuronColourRgb01,
  u01ToSigned,
  u32ToU01,
} from "../docs/shared/colour_maps.js";

// --- hash32 ---

Deno.test("hash32 returns a stable uint32 for the same input", () => {
  const h1 = hash32("hello");
  const h2 = hash32("hello");
  assertEquals(h1, h2);
  assertEquals(typeof h1, "number");
  assert(h1 >= 0 && h1 <= 0xFFFFFFFF, "Expected uint32 range");
});

Deno.test("hash32 produces different hashes for different strings", () => {
  const a = hash32("input-0");
  const b = hash32("hidden-abc");
  assert(a !== b, "Expected different hashes for different inputs");
});

Deno.test("hash32 handles empty string", () => {
  const h = hash32("");
  assertEquals(typeof h, "number");
  assert(h >= 0 && h <= 0xFFFFFFFF);
});

// --- u01ToSigned ---

Deno.test("u01ToSigned maps 0 to -1", () => {
  approx(u01ToSigned(0), -1);
});

Deno.test("u01ToSigned maps 0.5 to 0", () => {
  approx(u01ToSigned(0.5), 0);
});

Deno.test("u01ToSigned maps 1 to 1", () => {
  approx(u01ToSigned(1), 1);
});

// --- u32ToU01 ---

Deno.test("u32ToU01 maps 0 to 0", () => {
  assertEquals(u32ToU01(0), 0);
});

Deno.test("u32ToU01 maps 2^32-1 to just under 1", () => {
  const result = u32ToU01(0xFFFFFFFF);
  assert(result >= 0 && result < 1, "Expected [0, 1)");
  assert(result > 0.99, "Expected close to 1");
});

Deno.test("u32ToU01 maps mid-range to approximately 0.5", () => {
  approx(u32ToU01(0x80000000), 0.5, 0.01);
});

// --- neuronColourRgb01 ---

Deno.test("neuronColourRgb01 returns an [r,g,b] triple in [0,1]", () => {
  const [r, g, b] = neuronColourRgb01("input", "IDENTITY");
  assert(r >= 0 && r <= 1, `r=${r} out of range`);
  assert(g >= 0 && g <= 1, `g=${g} out of range`);
  assert(b >= 0 && b <= 1, `b=${b} out of range`);
});

Deno.test("neuronColourRgb01 differentiates input, output, hidden", () => {
  const inp = neuronColourRgb01("input", "IDENTITY");
  const out = neuronColourRgb01("output", "IDENTITY");
  const hid = neuronColourRgb01("hidden", "TANH");

  const differs = (a: number[], b: number[]) =>
    a.some((v, i) => Math.abs(v - b[i]) > 0.01);

  assert(differs(inp, out), "input and output should have different colours");
  assert(differs(inp, hid), "input and hidden should have different colours");
  assert(differs(out, hid), "output and hidden should have different colours");
});

Deno.test("neuronColourRgb01 flavours hidden neurons by squash", () => {
  const tanh = neuronColourRgb01("hidden", "TANH");
  const relu = neuronColourRgb01("hidden", "RELU");
  const step = neuronColourRgb01("hidden", "STEP");

  const differs = (a: number[], b: number[]) =>
    a.some((v, i) => Math.abs(v - b[i]) > 0.005);

  assert(differs(tanh, relu), "TANH and RELU should produce different colours");
  assert(differs(tanh, step), "TANH and STEP should produce different colours");
});

Deno.test("neuronColourRgb01 handles null/undefined gracefully", () => {
  // deno-lint-ignore no-explicit-any
  const [r, g, b] = neuronColourRgb01(null as any, null as any);
  assert(r >= 0 && r <= 1);
  assert(g >= 0 && g <= 1);
  assert(b >= 0 && b <= 1);
});
