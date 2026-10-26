import { createImage, defineFilter, linearToSrgb, luminance, type LinearImage } from '@rullino/core';
import { clampLoad, convolve1d, gaussianPass, gaussianWeights, q16 } from '../convolution';

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
  // Hard decisions: f32 (GPU) vs f64 (CPU) arithmetic can flip a few borderline pixels.
  tolerance: { abs: 0, rel: 0, outliers: 0.002 },
});
