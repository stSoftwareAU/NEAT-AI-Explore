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
 * @param {number} u01
 * @returns {number}
 */
export function u01ToSigned(u01) {
  return (u01 * 2) - 1;
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
