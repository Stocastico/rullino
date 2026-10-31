import { createImage, defineFilter, linearToSrgb, luminance, type LinearImage } from '@rullino/core';
import { float16ToFloat32, float32ToFloat16 } from '@rullino/core/internal';
import { clampLoad, convolve1d, gaussianPass, gaussianReach, gaussianWeights, q16 } from '../convolution';
import { convolve1dFast } from '../fast';

/** tan(22.5°): boundary between the four quantised gradient directions. */
const TAN_22_5 = 0.41421356;

const map = (src: LinearImage, f: (x: number, y: number) => [number, number, number, number]): LinearImage => {
  const out = createImage(src.width, src.height);
  for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) out.data.set(f(x, y), (y * src.width + x) * 4);
  return out;
};

/** Neighbour offset along the quantised gradient direction (0: →, 1: ↘, 2: ↓, 3: ↗). */
const DIRS: [number, number][] = [[1, 0], [1, 1], [0, 1], [1, -1]];

/**
 * Canny edge detector on perceptual luminance (sRGB-encoded luminance of the premultiplied colour,
 * i.e. as seen over black): Gaussian smoothing, Sobel gradient, non-maximum suppression with
 * 45° directions, double threshold, then `iterations` rounds of 8-connected hysteresis (enough
 * rounds equal full hysteresis). Thresholds are on |∇| / 4 of the encoded luminance, so a hard
 * 0→1 step reads about 0.6 at σ = 1. Output: white edges on black, alpha kept.
 */
export const canny = defineFilter({
  id: 'canny',
  label: 'Canny edges',
  description: 'Finds thin, connected edges: smooths the picture, measures the gradient, thins it to one pixel, then keeps strong edges and the weak ones attached to them.',
  tryThis: 'Lower the high threshold until the outline of the main subject appears, then raise the low threshold to cut the noise.',
  category: 'classic',
  kind: 'multipass',
  params: {
    sigma: { type: 'float', min: 0, max: 10, step: 0.1, default: 1.4, unit: 'px', label: 'Smoothing σ (px)', description: 'Blur applied first, in pixels. More smoothing ignores fine texture.' },
    low: { type: 'float', min: 0, max: 1, step: 0.005, default: 0.05, label: 'Low threshold', description: 'Gradients below this are never edges; between low and high they count only when connected to a strong edge.' },
    high: { type: 'float', min: 0, max: 1, step: 0.005, default: 0.15, label: 'High threshold', description: 'Gradients above this are always edges.' },
    iterations: { type: 'int', min: 0, max: 256, default: 64, label: 'Hysteresis iterations', description: 'How many rounds are used to follow weak edges. Enough rounds give the full result; more only costs time.' },
  },
  passes: [
    {
      name: 'lum',
      inputs: ['input'],
      wgsl: /* wgsl */ `
fn run(xy: vec2i, p: Params) -> vec4f {
  let v = rl_linear_to_srgb(vec3f(rl_luminance(load_input(xy).rgb))).x;
  return vec4f(v, v, v, 1.0);
}`,
    },
    gaussianPass('h', 'lum', 'x'),
    gaussianPass('v', 'h', 'y'),
    {
      name: 'grad',
      inputs: ['v'],
      wgsl: /* wgsl */ `
fn px(xy: vec2i, dx: i32, dy: i32) -> f32 { return load_v(xy + vec2i(dx, dy)).r; }
fn run(xy: vec2i, p: Params) -> vec4f {
  let gx = (px(xy, 1, -1) + 2.0 * px(xy, 1, 0) + px(xy, 1, 1)) - (px(xy, -1, -1) + 2.0 * px(xy, -1, 0) + px(xy, -1, 1));
  let gy = (px(xy, -1, 1) + 2.0 * px(xy, 0, 1) + px(xy, 1, 1)) - (px(xy, -1, -1) + 2.0 * px(xy, 0, -1) + px(xy, 1, -1));
  let ax = abs(gx);
  let ay = abs(gy);
  var s = 3.0;
  if (ay <= ax * ${TAN_22_5}) { s = 0.0; } else if (ax <= ay * ${TAN_22_5}) { s = 2.0; } else if (gx * gy > 0.0) { s = 1.0; }
  return vec4f(sqrt(gx * gx + gy * gy) * 0.25, s, 0.0, 1.0);
}`,
    },
    {
      name: 'nms',
      inputs: ['grad'],
      wgsl: /* wgsl */ `
fn dir(s: f32) -> vec2i {
  switch u32(s) {
    case 0u: { return vec2i(1, 0); }
    case 1u: { return vec2i(1, 1); }
    case 2u: { return vec2i(0, 1); }
    default: { return vec2i(1, -1); }
  }
}
fn run(xy: vec2i, p: Params) -> vec4f {
  let g = load_grad(xy);
  let d = dir(g.y);
  // >= on one side and > on the other keeps exactly one pixel of a symmetric ridge.
  var c = 0.0;
  if (g.x >= load_grad(xy + d).x && g.x > load_grad(xy - d).x) {
    if (g.x >= p.high) { c = 1.0; } else if (g.x >= p.low) { c = 0.5; }
  }
  return vec4f(c, 0.0, 0.0, 1.0);
}`,
    },
    {
      name: 'hyst',
      inputs: ['nms'],
      repeat: 'iterations',
      wgsl: /* wgsl */ `
fn run(xy: vec2i, p: Params) -> vec4f {
  let c = load_nms(xy).x;
  if (c > 0.25 && c < 0.75) {
    for (var j = -1; j <= 1; j++) {
      for (var i = -1; i <= 1; i++) {
        if (load_nms(xy + vec2i(i, j)).x > 0.75) { return vec4f(1.0, 0.0, 0.0, 1.0); }
      }
    }
  }
  return vec4f(c, 0.0, 0.0, 1.0);
}`,
    },
    {
      name: 'out',
      inputs: ['input', 'hyst'],
      wgsl: /* wgsl */ `
fn run(xy: vec2i, p: Params) -> vec4f {
  let a = load_input(xy).a;
  let v = select(0.0, a, load_hyst(xy).x > 0.75);
  return vec4f(v, v, v, a);
}`,
    },
  ],
  // Gaussian, Sobel (1), non-maximum suppression (1), then one pixel per hysteresis round.
  reach: ({ sigma, iterations }) => gaussianReach(sigma) + 2 + iterations,
  cpu: (src, { sigma, low, high, iterations }) => {
    // Mirrors the passes, rounding each intermediate to f16 like the GPU textures.
    const lum = q16(map(src, (x, y) => {
      const o = (y * src.width + x) * 4;
      const v = linearToSrgb(luminance(src.data[o]!, src.data[o + 1]!, src.data[o + 2]!));
      return [v, v, v, 1];
    }));
    const w = gaussianWeights(sigma);
    const blurred = q16(convolve1d(q16(convolve1d(lum, w, 'x')), w, 'y'));
    const px = (x: number, y: number) => clampLoad(blurred, x, y, 0);
    const grad = q16(map(blurred, (x, y) => {
      const gx = px(x + 1, y - 1) + 2 * px(x + 1, y) + px(x + 1, y + 1) - (px(x - 1, y - 1) + 2 * px(x - 1, y) + px(x - 1, y + 1));
      const gy = px(x - 1, y + 1) + 2 * px(x, y + 1) + px(x + 1, y + 1) - (px(x - 1, y - 1) + 2 * px(x, y - 1) + px(x + 1, y - 1));
      const ax = Math.abs(gx);
      const ay = Math.abs(gy);
      const s = ay <= ax * TAN_22_5 ? 0 : ax <= ay * TAN_22_5 ? 2 : gx * gy > 0 ? 1 : 3;
      return [Math.sqrt(gx * gx + gy * gy) * 0.25, s, 0, 1];
    }));
    let cls = map(grad, (x, y) => {
      const m = clampLoad(grad, x, y, 0);
      const [dx, dy] = DIRS[clampLoad(grad, x, y, 1)]!;
      const keep = m >= clampLoad(grad, x + dx, y + dy, 0) && m > clampLoad(grad, x - dx, y - dy, 0);
      return [keep ? (m >= high ? 1 : m >= low ? 0.5 : 0) : 0, 0, 0, 1];
    });
    for (let it = 0; it < iterations; it++) {
      const prev = cls;
      cls = map(prev, (x, y) => {
        const c = clampLoad(prev, x, y, 0);
        if (c > 0.25 && c < 0.75)
          for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (clampLoad(prev, x + i, y + j, 0) > 0.75) return [1, 0, 0, 1];
        return [c, 0, 0, 1];
      });
    }
    return map(src, (x, y) => {
      const a = src.data[(y * src.width + x) * 4 + 3]!;
      const v = clampLoad(cls, x, y, 0) > 0.75 ? a : 0;
      return [v, v, v, a];
    });
  },
  fast: (src, { sigma, low, high, iterations }) => {
    const { width: w, height: h } = src;
    // Same stages and the same f16 roundings as the reference, on plain planes.
    const lum = createImage(w, h);
    for (let i = 0; i < w * h; i++) {
      const o = i * 4;
      const v = linearToSrgb(luminance(src.data[o]!, src.data[o + 1]!, src.data[o + 2]!));
      lum.data[o] = lum.data[o + 1] = lum.data[o + 2] = v;
      lum.data[o + 3] = 1;
    }
    const wts = gaussianWeights(sigma);
    const b = q16(convolve1dFast(q16(convolve1dFast(q16(lum), wts, 'x')), wts, 'y')).data;
    const mag = new Float32Array(w * h);
    const dir = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const up = Math.max(0, y - 1) * w;
      const mid = y * w;
      const dn = Math.min(h - 1, y + 1) * w;
      for (let x = 0; x < w; x++) {
        const l = Math.max(0, x - 1);
        const r = Math.min(w - 1, x + 1);
        const gx = b[(up + r) * 4]! + 2 * b[(mid + r) * 4]! + b[(dn + r) * 4]! - (b[(up + l) * 4]! + 2 * b[(mid + l) * 4]! + b[(dn + l) * 4]!);
        const gy = b[(dn + l) * 4]! + 2 * b[(dn + x) * 4]! + b[(dn + r) * 4]! - (b[(up + l) * 4]! + 2 * b[(up + x) * 4]! + b[(up + r) * 4]!);
        const ax = Math.abs(gx);
        const ay = Math.abs(gy);
        dir[mid + x] = ay <= ax * TAN_22_5 ? 0 : ax <= ay * TAN_22_5 ? 2 : gx * gy > 0 ? 1 : 3;
        mag[mid + x] = float16ToFloat32(float32ToFloat16(Math.sqrt(gx * gx + gy * gy) * 0.25));
      }
    }
    // 0: no edge, 1: weak, 2: strong.
    const state = new Uint8Array(w * h);
    let weak: number[] = [];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const m = mag[i]!;
        const [dx, dy] = DIRS[dir[i]!]!;
        const fx = Math.min(w - 1, Math.max(0, x + dx));
        const fy = Math.min(h - 1, Math.max(0, y + dy));
        const bx = Math.min(w - 1, Math.max(0, x - dx));
        const by = Math.min(h - 1, Math.max(0, y - dy));
        if (m >= mag[fy * w + fx]! && m > mag[by * w + bx]!) {
          if (m >= high) state[i] = 2;
          else if (m >= low) {
            state[i] = 1;
            weak.push(i);
          }
        }
      }
    // One round promotes the weak pixels that touch a strong one in the previous state; stop when
    // a round changes nothing (later rounds could not either).
    for (let it = 0; it < iterations && weak.length > 0; it++) {
      const promoted: number[] = [];
      const rest: number[] = [];
      for (const i of weak) {
        const x = i % w;
        const y = (i - x) / w;
        let hit = false;
        for (let j = Math.max(0, y - 1); j <= Math.min(h - 1, y + 1) && !hit; j++)
          for (let k = Math.max(0, x - 1); k <= Math.min(w - 1, x + 1); k++)
            if (state[j * w + k] === 2) {
              hit = true;
              break;
            }
        (hit ? promoted : rest).push(i);
      }
      if (promoted.length === 0) break;
      for (const i of promoted) state[i] = 2;
      weak = rest;
    }
    const out = createImage(w, h);
    for (let i = 0; i < w * h; i++) {
      const a = src.data[i * 4 + 3]!;
      const v = state[i] === 2 ? a : 0;
      out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = v;
      out.data[i * 4 + 3] = a;
    }
    return out;
  },
  // Hard decisions: f32 (GPU) vs f64 (CPU) arithmetic can flip a few borderline pixels.
  tolerance: { abs: 0, rel: 0, outliers: 0.002 },
  // RTX 40: 0.3% of channels at high = 0 (every gradient pixel is a strong edge: more borderline decisions).
  hardwareTolerance: { abs: 0, rel: 0, outliers: 0.004 },
});
