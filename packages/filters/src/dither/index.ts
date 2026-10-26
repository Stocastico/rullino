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

/** PCG hash (O'Neill), u32 -> u32; identical on CPU and GPU (as in grain). */
function pcg(v: number): number {
  const s = (Math.imul(v, 747796405) + 2891336453) >>> 0;
  const w = Math.imul(((s >>> ((s >>> 28) + 4)) ^ s) >>> 0, 277803737) >>> 0;
  return ((w >>> 22) ^ w) >>> 0;
}

/** White-noise threshold in [0, 1) for a cell: a 24-bit hash, so the f32 conversion is exact. */
export const whiteNoise = (x: number, y: number, seed: number) => (pcg((x + pcg((y + pcg(seed)) >>> 0)) >>> 0) >>> 8) / 16777216;

/**
 * R2 threshold in [0, 1) for a cell: Roberts' plastic-ratio lattice, fract(x·0.7548776662 + y·0.5698402910)
 * in 32-bit fixed point (the constants times 2³²), so CPU and GPU agree exactly. A well-spread pattern
 * (no clumps, no grid) without a noise texture: the cheap stand-in for blue noise.
 */
export const r2 = (x: number, y: number) => ((Math.imul(x, 3242174889) + Math.imul(y, 2447445414)) >>> 8) / 16777216;

/**
 * Dithering to `levels` levels per channel, in sRGB-encoded units: each value is rounded down or
 * up by comparing it with a threshold, so the local mean of the pattern keeps the tone. The
 * threshold comes from a Bayer matrix (ordered, regular), white noise (a hash, seeded) or the R2
 * lattice (evenly spread, no visible grid). Mono dithers luminance into greys (a `gradientMap`
 * after it turns them into any two or three colours). `scale` enlarges the pattern cells.
 */
export const dither = defineFilter({
  id: 'dither',
  label: 'Dither',
  description: 'Reduces the picture to a few tones and uses a pattern of dots to fake the in-between ones, as in old newspapers and retro screens.',
  tryThis: 'Set Levels to 2 and compare Bayer 8×8 with White noise, then chain a Gradient map for a palette.',
  category: 'stylize',
  kind: 'multipass',
  params: {
    levels: { type: 'int', min: 2, max: 16, default: 2, label: 'Levels', description: 'How many tones are kept per channel. 2 is pure black and white.' },
    matrix: {
      type: 'enum',
      options: { bayer2: 'Bayer 2×2', bayer4: 'Bayer 4×4', bayer8: 'Bayer 8×8', white: 'White noise', gradient: 'R2 (evenly spread)' },
      default: 'bayer4',
      label: 'Pattern',
      description: 'The pattern that decides where each dot goes: ordered Bayer grids, random white noise, or the evenly spread R2 pattern.',
    },
    seed: { type: 'int', min: 0, max: 999, default: 0, label: 'Noise seed', description: 'Changes the random pattern; only used by White noise.' },
    mode: { type: 'enum', options: { mono: 'Mono', color: 'Colour' }, default: 'mono', label: 'Colours', description: 'Mono dithers the brightness only; Colour dithers each colour channel.' },
    scale: { type: 'int', min: 1, max: 16, default: 1, unit: 'px', label: 'Cell size (px)', description: 'Size of each pattern cell in pixels; larger gives a chunkier look.' },
  },
  passes: [
    {
      name: 'out',
      inputs: ['input'],
      wgsl: /* wgsl */ `
fn pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}

fn threshold(xy: vec2i) -> f32 {
  let q = xy / params.scale;
  if (params.matrix == 3u) {
    return f32(pcg(u32(q.x) + pcg(u32(q.y) + pcg(u32(params.seed)))) >> 8u) / 16777216.0;
  }
  if (params.matrix == 4u) {
    return f32((u32(q.x) * 3242174889u + u32(q.y) * 2447445414u) >> 8u) / 16777216.0;
  }
  let n = 2 << params.matrix;
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
  cpu: (src, { levels, matrix, seed, mode, scale }) => {
    const out = createImage(src.width, src.height);
    const n = levels - 1;
    for (let y = 0; y < src.height; y++)
      for (let x = 0; x < src.width; x++) {
        const i = (y * src.width + x) * 4;
        const a = src.data[i + 3]!;
        if (a <= 0) {
          out.data.set(src.data.subarray(i, i + 4), i);
          continue;
        }
        const [cx, cy] = [Math.floor(x / scale), Math.floor(y / scale)];
        const t = matrix === 'white' ? whiteNoise(cx, cy, seed) : matrix === 'gradient' ? r2(cx, cy) : (bayer(cx, cy, SIZES[matrix]) + 0.5) / (SIZES[matrix] * SIZES[matrix]);
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
