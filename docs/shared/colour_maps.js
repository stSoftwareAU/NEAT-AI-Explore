/**
 * Shared colour mapping for NEAT-AI Explore visualisations.
 *
 * The goal is not to be "scientific", but to be consistent and legible so
 * people can build intuition over time.
 *
 * Last updated: 30-Dec-2025
 */

/**
 * @param {number} h
 * @param {number} s
 * @param {number} l
 * @returns {[number, number, number]}
 */
function hslToRgb01(h, s, l) {
  // h: 0..360, s/l: 0..1; returns r/g/b 0..1
  const hh = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = l - c / 2;
  let rp = 0, gp = 0, bp = 0;
  if (hh < 60) [rp, gp, bp] = [c, x, 0];
  else if (hh < 120) [rp, gp, bp] = [x, c, 0];
  else if (hh < 180) [rp, gp, bp] = [0, c, x];
  else if (hh < 240) [rp, gp, bp] = [0, x, c];
  else if (hh < 300) [rp, gp, bp] = [x, 0, c];
  else [rp, gp, bp] = [c, 0, x];
  return [rp + m, gp + m, bp + m];
}

/**
 * Stable string hash (FNV-1a-ish) used for seeded visual jitter.
 * @param {string} s
 * @returns {number} uint32
 */
export function hash32(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * @param {number} u32
 * @returns {number} in [0, 1)
 */
export function u32ToU01(u32) {
  return ((u32 >>> 0) / 4294967296);
}

/**
 * Map neuron type + squash to an RGB colour (0..1).
 *
 * @param {string} type
 * @param {string} squash
 * @returns {[number, number, number]}
 */
export function neuronColourRgb01(type, squash) {
  const t = String(type ?? "").toLowerCase();
  const s = String(squash ?? "").toUpperCase();

  // Base hues by neuron role
  let hue = 210; // default cool blue
  let sat = 0.75;
  let lit = 0.55;

  if (t === "input") {
    hue = 130; // green
    sat = 0.70;
    lit = 0.55;
  } else if (t === "output") {
    hue = 35; // amber/orange
    sat = 0.85;
    lit = 0.55;
  } else if (t === "constant") {
    hue = 280; // purple
    sat = 0.60;
    lit = 0.58;
  } else if (t === "hidden") {
    hue = 210; // blue baseline; squash will flavour it below
    sat = 0.78;
    lit = 0.55;
  }

  // Squash flavouring (hidden neurons only).
  if (t === "hidden") {
    // Group squashes by broad behaviour.
    if (s.includes("TANH") || s.includes("SIGMOID") || s.includes("LOGISTIC")) {
      hue += 20;
      sat += 0.04;
    } else if (s.includes("RELU") || s.includes("LEAKY")) {
      hue -= 18;
      sat += 0.02;
      lit += 0.02;
    } else if (s.includes("STEP") || s.includes("BIPOLAR")) {
      hue += 55;
      sat += 0.08;
      lit -= 0.02;
    } else if (s.includes("SIN") || s.includes("COS") || s.includes("TAN")) {
      hue += 110;
      sat += 0.02;
    } else if (s.includes("IDENTITY") || s.includes("LINEAR")) {
      hue -= 8;
      sat -= 0.06;
      lit += 0.03;
    }
  }

  sat = Math.min(1, Math.max(0, sat));
  lit = Math.min(1, Math.max(0, lit));
  return hslToRgb01(hue, sat, lit);
}

/**
 * Normalise a synapse weight to a strength value in [0, 1].
 *
 * Uses sqrt compression so weak connections are still visible while
 * strong ones saturate smoothly.
 *
 * @param {number} weight    — the raw synapse weight
 * @param {number} [maxAbsWeight=5] — reference maximum absolute weight
 * @returns {number} in [0, 1]
 */
export function synapseWeightStrength01(weight, maxAbsWeight = 5) {
  if (!maxAbsWeight || !Number.isFinite(maxAbsWeight) || maxAbsWeight <= 0) {
    return 0;
  }
  const ratio = Math.abs(weight) / maxAbsWeight;
  return Math.min(1, Math.sqrt(Math.min(1, ratio)));
}

/**
 * Map a synapse weight to an RGB colour (0..1) on a diverging red↔blue scale
 * centred on zero (see #235 for the palette decision and #244 for the legend
 * update that aligned the inbound-synapses panel with it).
 *
 * - Positive weights → blue  (light → deep as strength increases)
 * - Negative weights → red   (light → deep as strength increases)
 * - Near-zero weights → neutral grey
 *
 * Hue choice (225° blue / 15° red) matches {@link divergingWeightSumColourCss}
 * so the topology diagram, observations-impact panel and synapse legend stay
 * visually consistent. The end-colour saturation is pushed higher (and the
 * lightness slightly lower) than the old green/red palette so the strong-±
 * swatches are noticeably more contrasting while still clearing WCAG AA
 * (3:1 for non-text graphical objects) against both the light and dark theme
 * backgrounds used by the app.
 *
 * @param {number} weight
 * @param {number} [maxAbsWeight=5]
 * @returns {[number, number, number]} [r, g, b] each in [0, 1]
 */
export function synapseWeightColourRgb01(weight, maxAbsWeight = 5) {
  const s = synapseWeightStrength01(weight, maxAbsWeight);

  // Near-zero → neutral grey (matches divergingWeightSumColourCss).
  if (s < 0.02) {
    return hslToRgb01(0, 0, 0.55);
  }

  const positive = weight >= 0;
  // Hue: 225° (blue) for positive, 15° (red) for negative.
  const hue = positive ? 225 : 15;
  // Saturation ramps from 0.10 (very weak) to 0.95 (strong) — higher end
  // saturation than the old palette (0.85) so the strong-± swatches stand out.
  const sat = 0.10 + 0.85 * s;
  // Lightness is held at 0.55 — matching {@link divergingWeightSumColourCss} —
  // because pushing it lower at the extremes (which would deepen the colour
  // further) drops the dark-theme contrast ratio below WCAG AA. The higher
  // end saturation alone produces the stronger visual contrast called for in
  // #244 while keeping both light- and dark-theme contrast ≥ 3:1.
  const lit = 0.55;

  return hslToRgb01(hue, sat, lit);
}

/**
 * Map a synapse weight to a CSS `rgb(…)` colour string.
 *
 * Convenience wrapper around {@link synapseWeightColourRgb01}.
 *
 * @param {number} weight
 * @param {number} [maxAbsWeight=5]
 * @returns {string} e.g. `"rgb(34, 197, 94)"`
 */
export function synapseWeightColourCss(weight, maxAbsWeight = 5) {
  const [r, g, b] = synapseWeightColourRgb01(weight, maxAbsWeight);
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${
    Math.round(b * 255)
  })`;
}

/**
 * Map an aggregate inter-layer `weightSum` to a CSS `rgb(…)` string on a
 * symmetric diverging scale.
 *
 * - Positive sums → blue (light → deep blue as magnitude grows).
 * - Negative sums → red  (light → deep red  as magnitude grows).
 * - Near-zero sums → neutral grey.
 *
 * The hue choice (blue ↔ red, both at mid lightness ≈ 0.45) keeps WCAG AA
 * contrast against both the light theme (near-white background) and dark
 * theme (near-black background) used elsewhere in the app.
 *
 * Equal-magnitude positive and negative values produce the same saturation
 * and lightness, only the hue flips between blue and red.
 *
 * @param {number} weightSum
 * @param {number} maxAbsWeightSum  reference maximum |weightSum|; values are
 *                                  normalised against this and clamped to 1.
 * @returns {string} e.g. `"rgb(70, 110, 200)"`
 */
export function divergingWeightSumColourCss(weightSum, maxAbsWeightSum) {
  // Guard non-finite inputs and degenerate ranges → neutral grey.
  if (
    !Number.isFinite(weightSum) ||
    !Number.isFinite(maxAbsWeightSum) ||
    maxAbsWeightSum <= 0
  ) {
    const g = Math.round(0.55 * 255);
    return `rgb(${g}, ${g}, ${g})`;
  }

  const ratio = Math.min(1, Math.abs(weightSum) / maxAbsWeightSum);

  // Near-zero → neutral grey.
  if (ratio < 0.02) {
    const g = Math.round(0.55 * 255);
    return `rgb(${g}, ${g}, ${g})`;
  }

  const positive = weightSum >= 0;
  // Hue choice: 225° (blue) and 15° (red). Both sit 15° inward from the
  // corresponding HSL sector corner, which keeps their internal `x`
  // contribution identical — so equal-magnitude ±weightSum produce truly
  // symmetric RGB triples (red ↔ blue channels swap, green channel matches).
  const hue = positive ? 225 : 15;
  // Saturation grows with magnitude (mirrors synapseWeightColourRgb01).
  const sat = 0.10 + 0.75 * ratio;
  // Lightness 0.55 keeps both light-theme and dark-theme contrast at or above
  // the WCAG AA 3:1 threshold for non-text graphical objects, even at maximum
  // saturation.
  const lit = 0.55;

  const [r, g, b] = hslToRgb01(hue, sat, lit);
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${
    Math.round(b * 255)
  })`;
}
