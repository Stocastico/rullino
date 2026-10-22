import { linearToOklab, linearToSrgb, luminance, type LinearImage } from '@rullino/core';

// "Auto": classical, deterministic suggestions for the white balance and levels filters, computed
// on the CPU from the image (the playground passes the shrunk original). No learning involved.

export interface AutoAdjustment {
  readonly whiteBalance: { readonly temperature: number; readonly tint: number };
  readonly levels: { readonly inBlack: number; readonly inWhite: number; readonly gamma: number };
}

/** Pixels with less OKLab chroma than this are taken as (tinted) neutrals for the white balance. */
const NEUTRAL_CHROMA = 0.08;
/**
 * Fraction of the estimated cast that is corrected: grey pixels are a guess (warm hay or dusk
 * light look like a cast), so stay conservative.
 */
const WB_STRENGTH = 0.5;
/** Largest suggested temperature / tint: Auto nudges, the user decides. */
const MAX_WB = 0.25;
/** Percentiles of luminance that become black and white. */
const CLIP = 0.005;
/** The stretch never moves the black point above / the white point below these. */
const MAX_BLACK = 0.35;
const MIN_WHITE = 0.6;
/** Gamma pulls the median (within the stretched range) into this band, at most by this factor. */
const MEDIAN_BAND = [0.3, 0.6] as const;
const MAX_GAMMA = 1.3;

/** Rounded to a slider step, without float noise (0.95, not 0.9500000000000001). */
const round = (x: number, step: number) => Number((Math.round(x / step) * step).toFixed(3));
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function autoAdjust(image: LinearImage): AutoAdjustment {
  const { data } = image;

  // White balance: mean of near-neutral, well-exposed pixels (straight colour), solved for the
  // white balance filter's gains: red / blue = 2^temperature, green / blue = 2^((temperature - tint) / 2).
  let [sr, sg, sb, n] = [0, 0, 0, 0];
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]!;
    if (a < 0.01) continue;
    const [r, g, b] = [data[i]! / a, data[i + 1]! / a, data[i + 2]! / a];
    const [L, A, B] = linearToOklab(r, g, b);
    if (L < 0.1 || Math.max(r, g, b) > 0.98 || Math.hypot(A, B) > NEUTRAL_CHROMA) continue;
    [sr, sg, sb, n] = [sr + r * a, sg + g * a, sb + b * a, n + a];
  }
  let temperature = 0;
  let tint = 0;
  if (n > 0.01 * (data.length / 4) && sr > 0 && sg > 0 && sb > 0) {
    const t = Math.log2(sb / sr);
    temperature = clamp(round(WB_STRENGTH * t, 0.01), -MAX_WB, MAX_WB);
    tint = clamp(round(WB_STRENGTH * (t - 2 * Math.log2(sb / sg)), 0.01), -MAX_WB, MAX_WB);
  }

  // Levels on the white-balanced luminance, in sRGB-encoded units like the levels filter.
  const gains = [2 ** (0.5 * temperature), 2 ** (-0.5 * tint), 2 ** (-0.5 * temperature)] as const;
  const norm = luminance(...gains);
  const BINS = 1024;
  const hist = new Float64Array(BINS);
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]!;
    if (a < 0.01) continue;
    const y = luminance((data[i]! / a) * gains[0], (data[i + 1]! / a) * gains[1], (data[i + 2]! / a) * gains[2]) / norm;
    hist[Math.min(BINS - 1, Math.max(0, Math.floor(linearToSrgb(y) * BINS)))]! += a;
    total += a;
  }
  if (total === 0) return { whiteBalance: { temperature, tint }, levels: { inBlack: 0, inWhite: 1, gamma: 1 } };
  const percentile = (q: number) => {
    let acc = 0;
    for (let k = 0; k < BINS; k++) {
      acc += hist[k]!;
      if (acc >= q * total) return (k + 0.5) / BINS;
    }
    return 1;
  };
  const inBlack = round(Math.min(MAX_BLACK, percentile(CLIP) - 0.5 / BINS), 0.005);
  const inWhite = round(Math.max(MIN_WHITE, percentile(1 - CLIP) + 0.5 / BINS), 0.005);
  const t = clamp((percentile(0.5) - inBlack) / (inWhite - inBlack), 1e-3, 1 - 1e-3);
  // levels maps t to t^(1/gamma): pull t into the band, no further.
  const target = clamp(t, ...MEDIAN_BAND);
  const gamma = target === t ? 1 : round(clamp(Math.log(t) / Math.log(target), 1 / MAX_GAMMA, MAX_GAMMA), 0.01);
  return { whiteBalance: { temperature, tint }, levels: { inBlack: Math.max(0, inBlack), inWhite: Math.min(1, inWhite), gamma } };
}
