// Building blocks of the fast CPU paths (`fast` on a filter). Each computes what a reference in
// convolution.ts computes, without per-sample closures or bounds clamping in the inner loop;
// fast.test.ts checks every filter that uses them against its reference.

import { createImage, linearToSrgb, srgbToLinear, type LinearImage, type Lut } from '@rullino/core';
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

// sRGB transfer functions by table lookup with linear interpolation on their curved segment up
// to 1 (exact elsewhere: the linear segment, HDR and negatives): a pow() per channel was half the time of the pointwise references.
// linearToSrgb is steep near 0, so its table is indexed by sqrt(x), where it is smooth.
const N = 4096;
const SRGB_OF_SQRT = Float64Array.from({ length: N + 1 }, (_, i) => linearToSrgb((i / N) ** 2));
const LINEAR_OF = Float64Array.from({ length: N + 1 }, (_, i) => srgbToLinear(i / N));

/** {@link linearToSrgb} within 1e-6 on its curved segment, exact elsewhere. */
export function toSrgb(x: number): number {
  if (!(x > 0.0031308 && x < 1)) return linearToSrgb(x); // the linear segment is cheap and exact
  const u = Math.sqrt(x) * N;
  const i = u | 0;
  const a = SRGB_OF_SQRT[i]!;
  return a + (SRGB_OF_SQRT[i + 1]! - a) * (u - i);
}

/** {@link srgbToLinear} within 1e-6 on its curved segment, exact elsewhere. */
export function toLinear(x: number): number {
  if (!(x > 0.04045 && x < 1)) return srgbToLinear(x);
  const u = x * N;
  const i = u | 0;
  const a = LINEAR_OF[i]!;
  return a + (LINEAR_OF[i + 1]! - a) * (u - i);
}

/**
 * A straight-alpha filter whose channels map independently (curves, levels): each channel of the
 * un-premultiplied colour goes through its function, the result is premultiplied again; colour of
 * a transparent pixel is 0, alpha is kept. One pass, nothing allocated per pixel.
 */
export function mapChannels(src: LinearImage, fr: (v: number) => number, fg: (v: number) => number, fb: (v: number) => number): LinearImage {
  const s = src.data;
  const out = createImage(src.width, src.height);
  const d = out.data;
  for (let i = 0; i < s.length; i += 4) {
    const a = s[i + 3]!;
    d[i + 3] = a;
    if (a <= 0) continue;
    d[i] = fr(s[i]! / a) * a;
    d[i + 1] = fg(s[i + 1]! / a) * a;
    d[i + 2] = fb(s[i + 2]! / a) * a;
  }
  return out;
}

/** `applyLutCpu` writing into `out[0..2]` instead of allocating: trilinear, domain-normalised, clamped. */
export function sampleLutInto(lut: Lut, r: number, g: number, b: number, out: Float64Array): void {
  const n = lut.size - 1;
  const { domainMin: lo, domainMax: hi, data } = lut;
  const pr = Math.min(1, Math.max(0, (r - lo[0]!) / (hi[0]! - lo[0]!))) * n;
  const pg = Math.min(1, Math.max(0, (g - lo[1]!) / (hi[1]! - lo[1]!))) * n;
  const pb = Math.min(1, Math.max(0, (b - lo[2]!) / (hi[2]! - lo[2]!))) * n;
  const r0 = Math.min(Math.floor(pr), n - 1);
  const g0 = Math.min(Math.floor(pg), n - 1);
  const b0 = Math.min(Math.floor(pb), n - 1);
  const fr = pr - r0;
  const fg = pg - g0;
  const fb = pb - b0;
  const sr = 3;
  const sg = 3 * lut.size;
  const sb = 3 * lut.size * lut.size;
  const base = b0 * sb + g0 * sg + r0 * sr;
  for (let c = 0; c < 3; c++) {
    const i = base + c;
    const c00 = data[i]! + (data[i + sr]! - data[i]!) * fr;
    const c10 = data[i + sg]! + (data[i + sg + sr]! - data[i + sg]!) * fr;
    const c01 = data[i + sb]! + (data[i + sb + sr]! - data[i + sb]!) * fr;
    const c11 = data[i + sb + sg]! + (data[i + sb + sg + sr]! - data[i + sb + sg]!) * fr;
    const lo0 = c00 + (c10 - c00) * fg;
    out[c] = lo0 + (c01 + (c11 - c01) * fg - lo0) * fb;
  }
}

/**
 * A straight-alpha filter that keeps alpha, in one pass: `f` receives the un-premultiplied colour
 * of each pixel with alpha > 0 and writes its result to `o[0..2]`, which is premultiplied again.
 * Colour of a transparent pixel is 0.
 */
export function mapStraight(src: LinearImage, f: (r: number, g: number, b: number, o: Float64Array) => void): LinearImage {
  const s = src.data;
  const out = createImage(src.width, src.height);
  const d = out.data;
  const o = new Float64Array(3);
  for (let i = 0; i < s.length; i += 4) {
    const a = s[i + 3]!;
    d[i + 3] = a;
    if (a <= 0) continue;
    f(s[i]! / a, s[i + 1]! / a, s[i + 2]! / a, o);
    d[i] = o[0]! * a;
    d[i + 1] = o[1]! * a;
    d[i + 2] = o[2]! * a;
  }
  return out;
}
