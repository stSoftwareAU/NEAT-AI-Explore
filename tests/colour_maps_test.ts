import { approx, assert, assertEquals } from "./test_helpers.ts";

import {
  divergingWeightSumColourCss,
  hash32,
  neuronColourRgb01,
  synapseWeightColourCss,
  synapseWeightColourRgb01,
  synapseWeightStrength01,
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

Deno.test("synapseWeightColourRgb01 positive weights are blueish (#244)", () => {
  // Diverging palette: positive → blue hue band (hue ~225°).
  const [r, _g, b] = synapseWeightColourRgb01(3, 5);
  assert(b > r, "Blue channel should dominate for positive weights");
});

Deno.test("synapseWeightColourRgb01 negative weights are reddish (#244)", () => {
  // Diverging palette: negative → red hue band (hue ~15°).
  const [r, _g, b] = synapseWeightColourRgb01(-3, 5);
  assert(r > b, "Red channel should dominate for negative weights");
});

Deno.test("synapseWeightColourRgb01 near-zero weights are greyish", () => {
  const [r, g, b] = synapseWeightColourRgb01(0.01, 5);
  // Grey means channels are close together
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  assert(spread < 0.15, `Near-zero should be grey (spread=${spread})`);
});

Deno.test("synapseWeightColourRgb01 stronger positive is more saturated (#244)", () => {
  const weak = synapseWeightColourRgb01(0.5, 5);
  const strong = synapseWeightColourRgb01(4.5, 5);
  // Stronger positive should show more blue dominance (b - r grows).
  const weakBlueDelta = weak[2] - weak[0];
  const strongBlueDelta = strong[2] - strong[0];
  assert(
    strongBlueDelta > weakBlueDelta,
    "Stronger positive should show more blue saturation",
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

Deno.test("synapseWeightColourCss positive weight produces blueish colour (#244)", () => {
  const css = synapseWeightColourCss(4, 5);
  const [r, _g, b] = parseRgb(css);
  assert(b > r, `Blue (${b}) should exceed red (${r}) for positive weight`);
});

Deno.test("synapseWeightColourCss negative weight produces reddish colour (#244)", () => {
  const css = synapseWeightColourCss(-4, 5);
  const [r, _g, b] = parseRgb(css);
  assert(r > b, `Red (${r}) should exceed blue (${b}) for negative weight`);
});

// --- synapseWeightColourRgb01 — diverging palette (#244) ---

// HSL hue extraction (max-min based) so tests can assert on hue ranges rather
// than exact RGB tuples.
function rgbHue([r, g, b]: [number, number, number]): number {
  const r1 = r / 255, g1 = g / 255, b1 = b / 255;
  const mx = Math.max(r1, g1, b1);
  const mn = Math.min(r1, g1, b1);
  const d = mx - mn;
  if (d === 0) return 0;
  let h: number;
  if (mx === r1) h = ((g1 - b1) / d) % 6;
  else if (mx === g1) h = (b1 - r1) / d + 2;
  else h = (r1 - g1) / d + 4;
  h = h * 60;
  if (h < 0) h += 360;
  return h;
}

// Convert rgb 0..1 → rounded 0..255 triple (mirrors synapseWeightColourCss).
function toRgb255(
  [r, g, b]: [number, number, number],
): [number, number, number] {
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

Deno.test("synapseWeightColourRgb01 at weight=0 lands in the neutral-grey band (#244)", () => {
  // Sweep several maxAbsWeight values; weight=0 must always be near-grey
  // (channels within a few units of each other, mid lightness).
  for (const mx of [0.5, 1, 5, 10, 100]) {
    const rgb255 = toRgb255(synapseWeightColourRgb01(0, mx));
    const spread = Math.max(...rgb255) - Math.min(...rgb255);
    assert(
      spread < 5,
      `weight=0 (maxAbs=${mx}) should be neutral grey, got spread=${spread}`,
    );
    // Mid lightness — average channel sits well clear of pure black/white.
    const avg = (rgb255[0] + rgb255[1] + rgb255[2]) / 3;
    assert(
      avg > 80 && avg < 200,
      `weight=0 should be mid-grey, got avg=${avg}`,
    );
  }
});

Deno.test("synapseWeightColourRgb01 symmetric ±k fall in opposite blue/red hue bands (#244)", () => {
  for (const k of [0.5, 1.5, 3, 4.5]) {
    const pos = toRgb255(synapseWeightColourRgb01(k, 5));
    const neg = toRgb255(synapseWeightColourRgb01(-k, 5));
    const hPos = rgbHue(pos);
    const hNeg = rgbHue(neg);
    // Positive → blue band roughly 200°–250°.
    assert(
      hPos >= 200 && hPos <= 250,
      `+${k} hue should be in blue band 200–250°, got ${hPos.toFixed(1)}°`,
    );
    // Negative → red band roughly 0°–40° (or wraps to 350°–360°).
    const inRedBand = (hNeg >= 0 && hNeg <= 40) ||
      (hNeg >= 350 && hNeg <= 360);
    assert(
      inRedBand,
      `-${k} hue should be in red band 0–40°, got ${hNeg.toFixed(1)}°`,
    );
  }
});

Deno.test("synapseWeightColourRgb01 strong ends have higher saturation + contrast than old green/red baseline (#244)", () => {
  // Regression baseline: the previous green-positive / red-negative palette
  // (captured at the +/-maxAbsWeight extremes with the old function shape:
  // hue=140/0, sat=0.85, lit=0.42). Stored as rgb 0..255 so the baseline
  // survives any future refactors of the helper.
  const OLD_POSITIVE: [number, number, number] = [16, 198, 92]; // green
  const OLD_NEGATIVE: [number, number, number] = [198, 16, 16]; // red

  const newPos = toRgb255(synapseWeightColourRgb01(5, 5));
  const newNeg = toRgb255(synapseWeightColourRgb01(-5, 5));

  // 1. Strong-end saturation: max-min channel spread is the simplest proxy
  //    for HSL saturation at fixed lightness.
  const sat = (rgb: [number, number, number]) =>
    Math.max(...rgb) - Math.min(...rgb);
  const oldSat = (sat(OLD_POSITIVE) + sat(OLD_NEGATIVE)) / 2;
  const newSat = (sat(newPos) + sat(newNeg)) / 2;
  assert(
    newSat > oldSat,
    `Strong-end saturation should grow vs old (old=${oldSat}, new=${newSat})`,
  );

  // 2. End-to-end contrast: Euclidean distance between the two strong
  //    swatches in RGB space — combines saturation and luminance differences.
  const dist = (
    a: [number, number, number],
    b: [number, number, number],
  ) =>
    Math.sqrt(
      (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2,
    );
  const oldContrast = dist(OLD_POSITIVE, OLD_NEGATIVE);
  const newContrast = dist(newPos, newNeg);
  assert(
    newContrast > oldContrast,
    `Strong-end contrast should grow vs old (old=${
      oldContrast.toFixed(1)
    }, new=${newContrast.toFixed(1)})`,
  );
});

Deno.test("synapseWeightColourCss is deterministic for the same inputs (#244)", () => {
  const samples = [-5, -3, -0.5, 0, 0.5, 3, 5];
  for (const w of samples) {
    const a = synapseWeightColourCss(w, 5);
    const b = synapseWeightColourCss(w, 5);
    assertEquals(
      a,
      b,
      `synapseWeightColourCss(${w}, 5) should be deterministic`,
    );
    assert(
      /^rgb\(\d+,\s*\d+,\s*\d+\)$/.test(a),
      `expected canonical rgb(...) string, got: ${a}`,
    );
  }
});

Deno.test("synapseWeightColourCss meets WCAG AA on light + dark themes (#244)", () => {
  // Same WCAG check used for divergingWeightSumColourCss — the strong-end
  // colours must clear the 3:1 non-text threshold against both backgrounds.
  const lightBg: [number, number, number] = [248, 249, 250];
  const darkBg: [number, number, number] = [18, 18, 20];
  const samples = [-5, -3, -1, 1, 3, 5];
  for (const w of samples) {
    const rgb = parseRgb(synapseWeightColourCss(w, 5));
    const cLight = contrastRatio(rgb, lightBg);
    const cDark = contrastRatio(rgb, darkBg);
    assert(
      cLight >= 3,
      `weight=${w} contrast on light bg too low: ${cLight.toFixed(2)}`,
    );
    assert(
      cDark >= 3,
      `weight=${w} contrast on dark bg too low: ${cDark.toFixed(2)}`,
    );
  }
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
