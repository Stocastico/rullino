import { createImage, defineFilter, linearToSrgb, srgbToLinear } from '@rullino/core';

/** PCG hash (O'Neill), u32 -> u32; identical on CPU and GPU. */
function pcg(v: number): number {
  const s = (Math.imul(v, 747796405) + 2891336453) >>> 0;
  const w = Math.imul(((s >>> ((s >>> 28) + 4)) ^ s) >>> 0, 277803737) >>> 0;
  return ((w >>> 22) ^ w) >>> 0;
}

/** Uniform noise in [-1, 1] at a lattice point. 24 bits, so the conversion to f32 is exact. */
const lattice = (ix: number, iy: number, seed: number) => ((pcg((ix + pcg((iy + pcg(seed)) >>> 0)) >>> 0) >>> 8) / 16777215) * 2 - 1;

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Value noise with cells of `size` pixels: lattice values at multiples of size, smoothly interpolated. */
function valueNoise(x: number, y: number, size: number, seed: number) {
  const px = x / size;
  const py = y / size;
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const fx = smooth(px - ix);
  const fy = smooth(py - iy);
  const top = lattice(ix, iy, seed) + (lattice(ix + 1, iy, seed) - lattice(ix, iy, seed)) * fx;
  const bottom = lattice(ix, iy + 1, seed) + (lattice(ix + 1, iy + 1, seed) - lattice(ix, iy + 1, seed)) * fx;
  return top + (bottom - top) * fy;
}

/** Grain strength by sRGB-encoded luminance: full in the midtones, 20% at black and white. */
const response = (y: number) => 0.2 + 0.8 * Math.min(1, Math.max(0, 4 * y * (1 - y)));

/**
 * Monochrome film grain: value noise (cells of `size` px) added to the straight sRGB-encoded
 * colour, scaled by a midtone-weighted response so shadows and highlights stay cleaner, like film.
 * Deterministic for a given seed.
 */
export const grain = defineFilter({
  id: 'grain',
  label: 'Grain',
  category: 'look',
  kind: 'multipass',
  params: {
    amount: { type: 'float', min: 0, max: 1, step: 0.01, default: 0.3, label: 'Amount' },
    size: { type: 'float', min: 1, max: 8, step: 0.1, default: 1.5, unit: 'px', label: 'Size' },
    seed: { type: 'int', min: 0, max: 999, default: 0, label: 'Seed' },
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

fn lattice(i: vec2i, seed: u32) -> f32 {
  return f32(pcg(u32(i.x) + pcg(u32(i.y) + pcg(seed))) >> 8u) / 16777215.0 * 2.0 - 1.0;
}

fn value_noise(xy: vec2f, size: f32, seed: u32) -> f32 {
  let pos = xy / size;
  let i = vec2i(floor(pos));
  let t = pos - floor(pos);
  let f = t * t * (3.0 - 2.0 * t);
  let top = lattice(i, seed) + (lattice(i + vec2i(1, 0), seed) - lattice(i, seed)) * f.x;
  let bottom = lattice(i + vec2i(0, 1), seed) + (lattice(i + vec2i(1, 1), seed) - lattice(i + vec2i(0, 1), seed)) * f.x;
  return top + (bottom - top) * f.y;
}

fn run(xy: vec2i, p: Params) -> vec4f {
  let c = rl_unpremultiply(load_input(xy));
  let e = rl_linear_to_srgb(c.rgb);
  let y = dot(e, vec3f(0.2126, 0.7152, 0.0722));
  let response = 0.2 + 0.8 * clamp(4.0 * y * (1.0 - y), 0.0, 1.0);
  let n = value_noise(vec2f(xy), p.size, u32(p.seed)) * 0.2 * p.amount * response;
  return rl_premultiply(vec4f(rl_srgb_to_linear(max(e + n, vec3f(0.0))), c.a));
}`,
    },
  ],
  cpu: (src, { amount, size, seed }) => {
    const { width: w, height: h } = src;
    const out = createImage(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const a = src.data[i + 3]!;
        if (a <= 0) continue; // colour of a transparent pixel is 0
        const e = [0, 1, 2].map((c) => linearToSrgb(src.data[i + c]! / a));
        const lum = 0.2126 * e[0]! + 0.7152 * e[1]! + 0.0722 * e[2]!;
        const n = valueNoise(x, y, size, seed) * 0.2 * amount * response(lum);
        for (let c = 0; c < 3; c++) out.data[i + c] = srgbToLinear(Math.max(e[c]! + n, 0)) * a;
        out.data[i + 3] = a;
      }
    }
    return out;
  },
  tolerance: { abs: 2e-4, rel: 2e-3 },
});
