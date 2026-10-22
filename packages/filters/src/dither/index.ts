import { createImage, defineFilter, linearToSrgb, luminance, srgbToLinear } from '@rullino/core';

/**
 * Bayer matrix entry at (x, y) for an n × n matrix (n a power of two), in 0..n²−1. Built from the
 * 2 × 2 pattern [[0, 2], [3, 1]] = 2·(x xor y) + y, one bit of x and y per level, the lowest bits
 * giving the most significant digit (M2n = 4·Mn + M2 of the high bits).
 */
export function bayer(x: number, y: number, n: number): number {
  let v = 0;
  for (let s = 1; s < n; s *= 2) {
    const [bx, by] = [Math.floor(x / s) % 2, Math.floor(y / s) % 2];
    v = v * 4 + 2 * (bx ^ by) + by;
  }
  return v;
}

const SIZES = { bayer2: 2, bayer4: 4, bayer8: 8 } as const;

/**
 * Ordered (Bayer) dithering to `levels` levels per channel, in sRGB-encoded units: each value is
 * rounded down or up by comparing it with a threshold from the matrix, so the local mean of the
 * pattern keeps the tone. Mono dithers luminance into greys. `scale` enlarges the pattern cells.
 */
export const dither = defineFilter({
  id: 'dither',
  label: 'Dither',
  category: 'stylize',
  kind: 'multipass',
  params: {
    levels: { type: 'int', min: 2, max: 16, default: 2, label: 'Levels' },
    matrix: { type: 'enum', options: { bayer2: 'Bayer 2×2', bayer4: 'Bayer 4×4', bayer8: 'Bayer 8×8' }, default: 'bayer4', label: 'Pattern' },
    mode: { type: 'enum', options: { mono: 'Mono', color: 'Colour' }, default: 'mono', label: 'Colours' },
    scale: { type: 'int', min: 1, max: 16, default: 1, unit: 'px', label: 'Cell size (px)' },
  },
  passes: [
    {
      name: 'out',
      inputs: ['input'],
      wgsl: /* wgsl */ `
fn threshold(xy: vec2i) -> f32 {
  let n = 2 << params.matrix;
  let q = xy / params.scale;
  var v = 0;
  var s = 1;
  for (var level = 0; s < n; level++) {
    let b = (q / s) % 2;
    v = v + (2 * (b.x ^ b.y) + b.y) * (n * n / (4 << u32(2 * level)));
    s = s * 2;
  }
  return (f32(v) + 0.5) / f32(n * n);
}

fn run(xy: vec2i, p: Params) -> vec4f {
  let s = load_input(xy);
  if (s.a <= 0.0) {
    return s;
  }
  var e = clamp(rl_linear_to_srgb(s.rgb / s.a), vec3f(0.0), vec3f(1.0));
  if (p.mode == 0u) {
    e = vec3f(clamp(rl_linear_to_srgb(vec3f(rl_luminance(s.rgb / s.a))).x, 0.0, 1.0));
  }
  let n = f32(p.levels - 1);
  let q = min(floor(e * n + threshold(xy)) / n, vec3f(1.0));
  return vec4f(rl_srgb_to_linear(q) * s.a, s.a);
}`,
    },
  ],
  cpu: (src, { levels, matrix, mode, scale }) => {
    const out = createImage(src.width, src.height);
    const size = SIZES[matrix];
    const n = levels - 1;
    for (let y = 0; y < src.height; y++)
      for (let x = 0; x < src.width; x++) {
        const i = (y * src.width + x) * 4;
        const a = src.data[i + 3]!;
        if (a <= 0) {
          out.data.set(src.data.subarray(i, i + 4), i);
          continue;
        }
        const t = (bayer(Math.floor(x / scale), Math.floor(y / scale), size) + 0.5) / (size * size);
        const [r, g, b] = [0, 1, 2].map((c) => src.data[i + c]! / a) as [number, number, number];
        const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
        const e = mode === 'mono' ? Array<number>(3).fill(clamp01(linearToSrgb(luminance(r, g, b)))) : [r, g, b].map((v) => clamp01(linearToSrgb(v)));
        out.data.set([...e.map((v) => srgbToLinear(Math.min(1, Math.floor(v * n + t) / n)) * a), a], i);
      }
    return out;
  },
  // A hard decision per channel: values within the GPU's sRGB-encoding error of a threshold can flip
  // (none measured on the parity images; 0.2% keeps a shifted threshold, ~0.6% flips, detectable).
  tolerance: { abs: 2e-3, rel: 2e-3, outliers: 0.002 },
});
