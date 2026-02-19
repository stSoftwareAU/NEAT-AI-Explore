import { approx, assert, assertEquals } from "./test_helpers.ts";

import {
  hash32,
  neuronColourRgb01,
  synapseWeightColourCss,
  synapseWeightColourRgb01,
  synapseWeightStrength01,
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

// --- synapseWeightStrength01 ---

Deno.test("synapseWeightStrength01 returns 0 for zero weight", () => {
  assertEquals(synapseWeightStrength01(0, 5), 0);
});

Deno.test("synapseWeightStrength01 returns 1 for max-magnitude weight", () => {
  approx(synapseWeightStrength01(5, 5), 1);
  approx(synapseWeightStrength01(-5, 5), 1);
});

Deno.test("synapseWeightStrength01 clamps to [0, 1]", () => {
  const s = synapseWeightStrength01(10, 5);
  assert(s >= 0 && s <= 1, `Expected [0,1] but got ${s}`);
});

Deno.test("synapseWeightStrength01 handles zero maxAbsWeight gracefully", () => {
  const s = synapseWeightStrength01(0, 0);
  assertEquals(s, 0);
});

Deno.test("synapseWeightStrength01 scales proportionally", () => {
  const half = synapseWeightStrength01(2.5, 5);
  const full = synapseWeightStrength01(5, 5);
  assert(half < full, "Half-weight should have lower strength than full");
  assert(half > 0, "Half-weight should be above zero");
});

// --- synapseWeightColourRgb01 ---

Deno.test("synapseWeightColourRgb01 returns [r,g,b] in [0,1]", () => {
  const [r, g, b] = synapseWeightColourRgb01(2.5, 5);
  assert(r >= 0 && r <= 1, `r=${r} out of range`);
  assert(g >= 0 && g <= 1, `g=${g} out of range`);
  assert(b >= 0 && b <= 1, `b=${b} out of range`);
});

Deno.test("synapseWeightColourRgb01 positive weights are greenish", () => {
  const [r, g, _b] = synapseWeightColourRgb01(3, 5);
  assert(g > r, "Green channel should dominate for positive weights");
});

Deno.test("synapseWeightColourRgb01 negative weights are reddish", () => {
  const [r, g, _b] = synapseWeightColourRgb01(-3, 5);
  assert(r > g, "Red channel should dominate for negative weights");
});

Deno.test("synapseWeightColourRgb01 near-zero weights are greyish", () => {
  const [r, g, b] = synapseWeightColourRgb01(0.01, 5);
  // Grey means channels are close together
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  assert(spread < 0.15, `Near-zero should be grey (spread=${spread})`);
});

Deno.test("synapseWeightColourRgb01 stronger positive is more saturated", () => {
  const weak = synapseWeightColourRgb01(0.5, 5);
  const strong = synapseWeightColourRgb01(4.5, 5);
  // Stronger positive should have more green dominance
  const weakGreenDelta = weak[1] - weak[0];
  const strongGreenDelta = strong[1] - strong[0];
  assert(
    strongGreenDelta > weakGreenDelta,
    "Stronger positive should show more green saturation",
  );
});

Deno.test("synapseWeightColourRgb01 handles zero weight as grey", () => {
  const [r, g, b] = synapseWeightColourRgb01(0, 5);
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  assert(spread < 0.05, `Zero weight should be grey (spread=${spread})`);
});

Deno.test("synapseWeightColourRgb01 handles default maxAbsWeight", () => {
  const [r, g, b] = synapseWeightColourRgb01(1);
  assert(r >= 0 && r <= 1);
  assert(g >= 0 && g <= 1);
  assert(b >= 0 && b <= 1);
});

// --- synapseWeightColourCss ---

Deno.test("synapseWeightColourCss returns valid rgb() string", () => {
  const css = synapseWeightColourCss(2, 5);
  assert(
    css.startsWith("rgb("),
    `Expected rgb(...) but got: ${css}`,
  );
  assert(css.endsWith(")"), `Expected closing paren: ${css}`);
});

Deno.test("synapseWeightColourCss positive weight produces greenish colour", () => {
  const css = synapseWeightColourCss(4, 5);
  // Parse rgb values
  const match = css.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  assert(match !== null, `Could not parse CSS: ${css}`);
  const [, rStr, gStr] = match!;
  const r = parseInt(rStr);
  const g = parseInt(gStr);
  assert(g > r, `Green (${g}) should exceed red (${r}) for positive weight`);
});

Deno.test("synapseWeightColourCss negative weight produces reddish colour", () => {
  const css = synapseWeightColourCss(-4, 5);
  const match = css.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  assert(match !== null, `Could not parse CSS: ${css}`);
  const [, rStr, gStr] = match!;
  const r = parseInt(rStr);
  const g = parseInt(gStr);
  assert(r > g, `Red (${r}) should exceed green (${g}) for negative weight`);
});
