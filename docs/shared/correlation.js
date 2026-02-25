/**
 * Input correlation analysis — pure computation, no DOM dependencies.
 *
 * Computes Pearson correlation coefficients between pairs of input neuron
 * activation series, returning the top-K most correlated pairs.
 */

/**
 * Compute the Pearson correlation coefficient between two numeric arrays.
 *
 * @param {number[]} x - First series.
 * @param {number[]} y - Second series.
 * @returns {number} Pearson r (0 if fewer than 3 data points or zero variance).
 */
export function pearsonCorrelation(x, y) {
  const n = Math.min(x.length, y.length);
  if (n < 3) return 0;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    const a = x[i];
    const b = y[i];
    sx += a;
    sy += b;
    sxx += a * a;
    syy += b * b;
    sxy += a * b;
  }
  const mx = sx / n;
  const my = sy / n;
  const vx = sxx / n - mx * mx;
  const vy = syy / n - my * my;
  const cov = sxy / n - mx * my;
  const denom = Math.sqrt(Math.max(0, vx)) * Math.sqrt(Math.max(0, vy));
  if (denom <= 0) return 0;
  return cov / denom;
}

/**
 * Evenly downsample an array, replacing non-finite values with 0.
 *
 * @param {number[]} arr - Source array.
 * @param {number} maxLen - Target length (minimum 8).
 * @returns {number[]} Downsampled array.
 */
export function sampleSeries(arr, maxLen = 512) {
  const take = Math.min(arr.length, Math.max(8, Math.floor(maxLen)));
  if (take >= arr.length) return arr;
  const step = arr.length / take;
  const out = [];
  for (let i = 0; i < take; i++) {
    const idx = Math.min(arr.length - 1, Math.floor(i * step));
    const v = arr[idx];
    out.push(typeof v === "number" && isFinite(v) ? v : 0);
  }
  return out;
}

/**
 * Compute the top-K most correlated input neuron pairs by |r|.
 *
 * @param {object} opts
 * @param {object|null} opts.recording - Recording data with `neurons` map and
 *   optional `obsIndices`.
 * @param {number} opts.inputCount - Total number of input neurons.
 * @param {number} [opts.maxInputs=80] - Cap on inputs to consider.
 * @param {number} [opts.sampleSize=512] - Downsample series to this length.
 * @param {number} [opts.topK=12] - Number of top pairs to return.
 * @returns {{ a: string, b: string, r: number }[]} Top pairs sorted by |r|
 *   descending.
 */
export function computeTopInputCorrelations(
  { recording, inputCount, maxInputs, sampleSize, topK },
) {
  const neurons = recording?.neurons ?? {};
  const nInputs = Math.max(0, Math.floor(inputCount ?? 0));
  const useInputs = Math.min(
    nInputs,
    Math.max(0, Math.floor(maxInputs ?? 80)),
  );
  if (useInputs < 2) return [];

  const seriesByUuid = [];
  for (let i = 0; i < useInputs; i++) {
    const uuid = `input-${i}`;
    const rec = neurons?.[uuid];
    const series = rec?.activation ?? rec?.value ?? null;
    if (Array.isArray(series) && series.length > 4) {
      seriesByUuid.push({ uuid, series });
    }
  }
  if (seriesByUuid.length < 2) return [];

  const sampled = seriesByUuid.map((s) => ({
    uuid: s.uuid,
    arr: sampleSeries(s.series, Math.max(8, Math.floor(sampleSize ?? 512))),
  }));

  // Compute top correlations (|r| high).
  const k = Math.max(1, Math.floor(topK ?? 12));
  /** @type {{ a: string, b: string, r: number }[]} */
  const top = [];

  function insert(item) {
    // keep ascending by |r|
    const ar = Math.abs(item.r);
    let lo = 0;
    let hi = top.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (Math.abs(top[mid].r) <= ar) lo = mid + 1;
      else hi = mid;
    }
    top.splice(lo, 0, item);
    if (top.length > k) top.shift();
  }

  for (let i = 0; i < sampled.length; i++) {
    for (let j = i + 1; j < sampled.length; j++) {
      const r = pearsonCorrelation(sampled[i].arr, sampled[j].arr);
      if (top.length < k || Math.abs(r) > Math.abs(top[0].r)) {
        insert({ a: sampled[i].uuid, b: sampled[j].uuid, r });
      }
    }
  }

  top.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));
  return top;
}
