import { approx, assert, assertEquals } from "./test_helpers.ts";

import {
  divergingWeightSumColourCss,
  hash32,
  neuronColourRgb01,
  synapseWeightColourCss,
  synapseWeightColourRgb01,
  synapseWeightStrength01,
  u01ToSigned,
  u32ToU01,
} from "../docs/shared/colour_maps.js";

function parseRgb(css: string): [number, number, number] {
  const m = css.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!m) throw new Error(`unparseable rgb(): ${css}`);
  return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
}

// Relative luminance per WCAG 2.x.
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const toLin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
}

function contrastRatio(
  a: [number, number, number],
  b: [number, number, number],
): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

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

// --- divergingWeightSumColourCss (issue #238) ---

Deno.test("divergingWeightSumColourCss returns a valid rgb() string", () => {
  const css = divergingWeightSumColourCss(2, 10);
  assert(css.startsWith("rgb("), `expected rgb(...) but got: ${css}`);
  assert(css.endsWith(")"), `expected closing paren: ${css}`);
  const [r, g, b] = parseRgb(css);
  for (const c of [r, g, b]) {
    assert(c >= 0 && c <= 255, `channel out of range: ${c}`);
  }
});

Deno.test("divergingWeightSumColourCss positive sum is blue-leaning", () => {
  const [r, _g, b] = parseRgb(divergingWeightSumColourCss(5, 10));
  assert(b > r, `expected blue (${b}) > red (${r}) for positive sum`);
});

Deno.test("divergingWeightSumColourCss negative sum is red-leaning", () => {
  const [r, _g, b] = parseRgb(divergingWeightSumColourCss(-5, 10));
  assert(r > b, `expected red (${r}) > blue (${b}) for negative sum`);
});

Deno.test("divergingWeightSumColourCss near-zero is neutral grey", () => {
  const [r, g, b] = parseRgb(divergingWeightSumColourCss(0.0001, 10));
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  assert(spread < 5, `near-zero should be grey (spread=${spread})`);
});

Deno.test("divergingWeightSumColourCss zero is neutral grey", () => {
  const [r, g, b] = parseRgb(divergingWeightSumColourCss(0, 10));
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  assert(spread < 5, `zero should be grey (spread=${spread})`);
});

Deno.test("divergingWeightSumColourCss symmetric ±x have equal-saturation opposite hues", () => {
  const pos = parseRgb(divergingWeightSumColourCss(3, 10));
  const neg = parseRgb(divergingWeightSumColourCss(-3, 10));

  // Opposite hues: blue channel dominant on positive, red dominant on negative.
  assert(pos[2] > pos[0], "positive should be blue-dominant");
  assert(neg[0] > neg[2], "negative should be red-dominant");

  // Equal saturation/lightness manifests as: the dominant channel on each side
  // has the same intensity, and the off-axis (green) channel matches too.
  assertEquals(
    pos[2],
    neg[0],
    `equal-saturation flip expected: pos blue=${pos[2]} vs neg red=${neg[0]}`,
  );
  assertEquals(pos[1], neg[1], "green channel should match (same lightness)");
  assertEquals(
    pos[0],
    neg[2],
    `equal-saturation flip expected: pos red=${pos[0]} vs neg blue=${neg[2]}`,
  );
});

Deno.test("divergingWeightSumColourCss clamps |weightSum| > maxAbsWeightSum", () => {
  // Beyond range should saturate, not exceed the deepest colour produced at the
  // boundary.
  const atMax = parseRgb(divergingWeightSumColourCss(10, 10));
  const beyond = parseRgb(divergingWeightSumColourCss(100, 10));
  assertEquals(atMax[0], beyond[0]);
  assertEquals(atMax[1], beyond[1]);
  assertEquals(atMax[2], beyond[2]);
});

Deno.test("divergingWeightSumColourCss handles invalid maxAbsWeightSum gracefully", () => {
  for (const bad of [0, -1, NaN, Infinity]) {
    const css = divergingWeightSumColourCss(1, bad);
    const [r, g, b] = parseRgb(css);
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    assert(
      spread < 5,
      `bad maxAbsWeightSum=${bad} should fall back to grey (spread=${spread})`,
    );
  }
});

Deno.test("divergingWeightSumColourCss meets WCAG AA on light + dark themes", () => {
  // Light theme background ≈ near-white; dark theme ≈ near-black. Mid lightness
  // chosen for the diverging palette should clear the AA threshold (3:1 for
  // non-text graphical objects) against both.
  const lightBg: [number, number, number] = [248, 249, 250];
  const darkBg: [number, number, number] = [18, 18, 20];
  const samples = [-9, -5, -1, 1, 5, 9];
  for (const w of samples) {
    const rgb = parseRgb(divergingWeightSumColourCss(w, 10));
    const cLight = contrastRatio(rgb, lightBg);
    const cDark = contrastRatio(rgb, darkBg);
    assert(
      cLight >= 3,
      `weightSum=${w} contrast on light bg too low: ${cLight.toFixed(2)}`,
    );
    assert(
      cDark >= 3,
      `weightSum=${w} contrast on dark bg too low: ${cDark.toFixed(2)}`,
    );
  }
});
