import { createImage, defineFilter, linearToSrgb, luminance } from '@rullino/core';

/** Histogram bin (0..255) of a straight colour's perceptual luminance. Mirrors `bin()` in WGSL. */
const binOf = (r: number, g: number, b: number) => Math.min(255, Math.floor(Math.min(1, Math.max(0, linearToSrgb(luminance(r, g, b)))) * 256));

const BIN_WGSL = /* wgsl */ `
fn bin(c: vec3f) -> u32 {
  let v = clamp(rl_linear_to_srgb(vec3f(rl_luminance(c))).x, 0.0, 1.0);
  return min(255u, u32(floor(v * 256.0)));
}`;

/**
 * Otsu's threshold: the bin t maximising the between-class variance of the histogram (pixels in
 * bins <= t vs > t). Ties keep the first maximum; an empty or single-level histogram gives 0.
 * Mirrors the 'level' pass.
 */
export function otsuThreshold(hist: readonly number[]): number {
  const total = hist.reduce((a, b) => a + b, 0);
  const sumAll = hist.reduce((a, h, i) => a + i * h, 0);
  let best = 0;
  let bestVar = 0;
  let wB = 0;
  let sumB = 0;
  for (let t = 0; t < 255; t++) {
    wB += hist[t]!;
    sumB += t * hist[t]!;
    const wF = total - wB;
    if (wB === 0 || wF === 0) continue;
    const d = sumB / wB - (sumAll - sumB) / wF;
    const v = wB * wF * d * d;
    if (v > bestVar) {
      bestVar = v;
      best = t;
    }
  }
  return best;
}

/**
 * Automatic global threshold (Otsu) on perceptual luminance. A 256-bin histogram of the straight
 * colour is built with atomics (fully transparent pixels are skipped), one invocation picks the
 * threshold, a last pass applies it: white above, black at or below, alpha kept.
 */
export const otsu = defineFilter({
  id: 'otsu',
  label: 'Otsu threshold',
  description: 'Turns the picture into black and white, choosing the best cut-off automatically from the histogram.',
  tryThis: 'Try it on a clear subject against a plain background.',
  category: 'classic',
  kind: 'multipass',
  params: {
    invert: { type: 'bool', default: false, label: 'Invert', description: 'Swap black and white.' },
  },
  buffers: { hist: 256, level: 1 },
  passes: [
    {
      kind: 'compute',
      name: 'histogram',
      inputs: ['input'],
      buffers: ['hist'],
      dispatch: 'pixels',
      wgsl: /* wgsl */ `${BIN_WGSL}
fn run(xy: vec2i, p: Params) {
  let c = load_input(xy);
  if (c.a <= 0.0) { return; }
  atomicAdd(&buf_hist[bin(rl_unpremultiply(c).rgb)], 1u);
}`,
    },
    {
      kind: 'compute',
      name: 'level',
      inputs: ['input'],
      buffers: ['hist', 'level'],
      dispatch: 'single',
      wgsl: /* wgsl */ `
fn run(xy: vec2i, p: Params) {
  var total = 0.0;
  var sumAll = 0.0;
  for (var i = 0u; i < 256u; i++) {
    let h = f32(atomicLoad(&buf_hist[i]));
    total += h;
    sumAll += f32(i) * h;
  }
  var best = 0u;
  var bestVar = 0.0;
  var wB = 0.0;
  var sumB = 0.0;
  for (var t = 0u; t < 255u; t++) {
    let h = f32(atomicLoad(&buf_hist[t]));
    wB += h;
    sumB += f32(t) * h;
    let wF = total - wB;
    if (wB == 0.0 || wF == 0.0) { continue; }
    let d = sumB / wB - (sumAll - sumB) / wF;
    let v = wB * wF * d * d;
    if (v > bestVar) {
      bestVar = v;
      best = t;
    }
  }
  atomicStore(&buf_level[0], best);
}`,
    },
    {
      name: 'out',
      inputs: ['input'],
      buffers: ['level'],
      wgsl: /* wgsl */ `${BIN_WGSL}
fn run(xy: vec2i, p: Params) -> vec4f {
  let c = rl_unpremultiply(load_input(xy));
  let on = (bin(c.rgb) > atomicLoad(&buf_level[0])) != (p.invert == 1u);
  let v = select(0.0, c.a, on);
  return vec4f(v, v, v, c.a);
}`,
    },
  ],
  cpu: (src, { invert }) => {
    const straight = (i: number): [number, number, number, number] => {
      const a = src.data[i + 3]!;
      return a > 0 ? [src.data[i]! / a, src.data[i + 1]! / a, src.data[i + 2]! / a, a] : [0, 0, 0, a];
    };
    const hist = new Array<number>(256).fill(0);
    for (let i = 0; i < src.data.length; i += 4) {
      const [r, g, b, a] = straight(i);
      if (a > 0) hist[binOf(r, g, b)]!++;
    }
    const t = otsuThreshold(hist);
    const out = createImage(src.width, src.height);
    for (let i = 0; i < src.data.length; i += 4) {
      const [r, g, b, a] = straight(i);
      const v = binOf(r, g, b) > t !== invert ? a : 0;
      out.data.set([v, v, v, a], i);
    }
    return out;
  },
  // f32 vs f64 luminance can move a pixel sitting on a bin edge into the neighbouring bin.
  tolerance: { abs: 0, rel: 0, outliers: 0.002 },
});
