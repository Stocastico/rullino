// Building blocks of the fast CPU paths (`fast` on a filter). Each computes what a reference in
// convolution.ts computes, without per-sample closures or bounds clamping in the inner loop;
// fast.test.ts checks every filter that uses them against its reference.

import { createImage, type LinearImage } from '@rullino/core';
import { gaussianWeights } from './convolution';

/**
 * {@link convolve1d} (symmetric weights, clamp-to-edge), all four channels at once, taps summed in
 * symmetric pairs. Along y whole rows are accumulated (sequential memory); along x the clamping is
 * confined to the first and last r pixels.
 */
export function convolve1dFast(src: LinearImage, weights: readonly number[], axis: 'x' | 'y'): LinearImage {
  const { width: w, height: h, data: s } = src;
  const r = (weights.length - 1) / 2;
  const k = Float64Array.from(weights);
  const out = createImage(w, h);
  const d = out.data;
  const row = w * 4;
  if (axis === 'y') {
    // Weights are symmetric: the rows y - t and y + t share one multiply.
    const acc = new Float64Array(row);
    for (let y = 0; y < h; y++) {
      const c = y * row;
      const kc = k[r]!;
      for (let i = 0; i < row; i++) acc[i] = kc * s[c + i]!;
      for (let t = 1; t <= r; t++) {
        const wt = k[r + t]!;
        const a = Math.max(0, y - t) * row;
        const b = Math.min(h - 1, y + t) * row;
        for (let i = 0; i < row; i++) acc[i]! += wt * (s[a + i]! + s[b + i]!);
      }
      d.set(acc, c);
    }
    return out;
  }
  for (let y = 0; y < h; y++) {
    const base = y * row;
    for (let x = 0; x < w; x++) {
      let a0 = 0, a1 = 0, a2 = 0, a3 = 0;
      if (x >= r && x < w - r) {
        const c = base + x * 4;
        const kc = k[r]!;
        a0 = kc * s[c]!;
        a1 = kc * s[c + 1]!;
        a2 = kc * s[c + 2]!;
        a3 = kc * s[c + 3]!;
        for (let t = 1; t <= r; t++) {
          const wt = k[r + t]!;
          const lo = c - 4 * t;
          const hi = c + 4 * t;
          a0 += wt * (s[lo]! + s[hi]!);
          a1 += wt * (s[lo + 1]! + s[hi + 1]!);
          a2 += wt * (s[lo + 2]! + s[hi + 2]!);
          a3 += wt * (s[lo + 3]! + s[hi + 3]!);
        }
      } else {
        for (let t = -r; t <= r; t++) {
          const wt = k[t + r]!;
          const j = base + Math.min(w - 1, Math.max(0, x + t)) * 4;
          a0 += wt * s[j]!;
          a1 += wt * s[j + 1]!;
          a2 += wt * s[j + 2]!;
          a3 += wt * s[j + 3]!;
        }
      }
      const o = base + x * 4;
      d[o] = a0;
      d[o + 1] = a1;
      d[o + 2] = a2;
      d[o + 3] = a3;
    }
  }
  return out;
}

/** {@link gaussianCpu}, fast. */
export const gaussianFast = (src: LinearImage, sigma: number): LinearImage => {
  const w = gaussianWeights(sigma);
  return convolve1dFast(convolve1dFast(src, w, 'x'), w, 'y');
};
