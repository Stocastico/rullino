import { createImage, defineFilter, linearToSrgb, luminance, type LinearImage } from '@rullino/core';
import { clampLoad, q16 } from '../convolution';
import { padEdge } from '../fast';

/** Added to every standard deviation: flat quadrants get a finite weight. */
const EPS = 0.005;
/** Quadrant offsets (x, y) of the far corner from the pixel: top-left, top-right, bottom-left, bottom-right. */
const QUADRANTS = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
] as const;

/** Encoded luminance of the straight colour in all four channels, as the GPU stores it: a half-float intermediate texture. */
function lumImage(src: LinearImage): LinearImage {
  const L: LinearImage = createImage(src.width, src.height);
  for (let i = 0; i < src.data.length; i += 4) {
    const a = src.data[i + 3]!;
    const l = a > 0 ? linearToSrgb(luminance(src.data[i]! / a, src.data[i + 1]! / a, src.data[i + 2]! / a)) : 0;
    L.data.fill(l, i, i + 4);
  }
  return q16(L);
}

/**
 * Smoothed Kuwahara: the four (r + 1)² quadrants around a pixel each give a mean colour and the
 * standard deviation σ of their sRGB-encoded luminance; the means are blended with weights
 * ((σ_min + ε) / (σ + ε))^sharpness, so the flattest side dominates. Flat areas get smoothed, edges
 * stay sharp, textures turn into painterly strokes. Blending (instead of picking the minimum)
 * avoids hard decisions. Means are of premultiplied values, alpha included.
 */
export const kuwahara = defineFilter({
  id: 'kuwahara',
  label: 'Kuwahara (painterly)',
  description: 'Smooths the picture into flat patches while keeping edges sharp, which looks like a painting.',
  tryThis: 'Raise the radius until fine texture turns into brush strokes.',
  category: 'stylize',
  kind: 'multipass',
  params: {
    radius: { type: 'int', min: 1, max: 10, default: 4, unit: 'px', label: 'Radius (px)', description: 'Size of the brush patches in pixels.' },
    sharpness: { type: 'float', min: 1, max: 16, step: 0.5, default: 8, label: 'Sharpness', description: 'How strongly each pixel follows the smoothest nearby patch; higher keeps edges crisper.' },
  },
  passes: [
    {
      name: 'lum',
      inputs: ['input'],
      wgsl: /* wgsl */ `
fn run(xy: vec2i, p: Params) -> vec4f {
  let s = load_input(xy);
  var l = 0.0;
  if (s.a > 0.0) {
    l = rl_linear_to_srgb(vec3f(rl_luminance(s.rgb / s.a))).x;
  }
  return vec4f(l);
}`,
    },
    {
      name: 'out',
      inputs: ['input', 'lum'],
      wgsl: /* wgsl */ `
const QUADRANTS = array<vec2i, 4>(vec2i(-1, -1), vec2i(1, -1), vec2i(-1, 1), vec2i(1, 1));

fn run(xy: vec2i, p: Params) -> vec4f {
  let r = p.radius;
  let n = f32((r + 1) * (r + 1));
  var means: array<vec4f, 4>;
  var sigmas: array<f32, 4>;
  var smin = 1e9;
  for (var q = 0; q < 4; q++) {
    let dir = QUADRANTS[q];
    var colour = vec4f(0.0);
    var mu = 0.0;
    for (var j = 0; j <= r; j++) {
      for (var i = 0; i <= r; i++) {
        let at = xy + dir * vec2i(i, j);
        colour += load_input(at);
        mu += load_lum(at).x;
      }
    }
    mu /= n;
    var ss = 0.0;
    for (var j = 0; j <= r; j++) {
      for (var i = 0; i <= r; i++) {
        let d = load_lum(xy + dir * vec2i(i, j)).x - mu;
        ss += d * d;
      }
    }
    means[q] = colour / n;
    sigmas[q] = sqrt(ss / n);
    smin = min(smin, sigmas[q]);
  }
  var acc = vec4f(0.0);
  var total = 0.0;
  for (var q = 0; q < 4; q++) {
    let w = pow((smin + ${EPS}) / (sigmas[q] + ${EPS}), p.sharpness);
    acc += w * means[q];
    total += w;
  }
  return acc / total;
}`,
    },
  ],
  cpu: (src, { radius: r, sharpness }) => {
    const lum = lumImage(src);
    const out = createImage(src.width, src.height);
    const n = (r + 1) * (r + 1);
    for (let y = 0; y < src.height; y++)
      for (let x = 0; x < src.width; x++) {
        const stats = QUADRANTS.map(([dx, dy]) => {
          const colour = [0, 0, 0, 0];
          const ls: number[] = [];
          for (let j = 0; j <= r; j++)
            for (let i = 0; i <= r; i++) {
              const [px, py] = [x + dx * i, y + dy * j];
              for (let c = 0; c < 4; c++) colour[c]! += clampLoad(src, px, py, c);
              ls.push(clampLoad(lum, px, py, 0));
            }
          const mu = ls.reduce((a, b) => a + b, 0) / n;
          return { mean: colour.map((v) => v / n), sigma: Math.sqrt(ls.reduce((a, l) => a + (l - mu) ** 2, 0) / n) };
        });
        const smin = Math.min(...stats.map((s) => s.sigma));
        const ws = stats.map((s) => ((smin + EPS) / (s.sigma + EPS)) ** sharpness);
        const total = ws.reduce((a, b) => a + b, 0);
        for (let c = 0; c < 4; c++) out.data[(y * src.width + x) * 4 + c] = stats.reduce((a, s, k) => a + ws[k]! * s.mean[c]!, 0) / total;
      }
    return out;
  },
  fast: (src, { radius: r, sharpness }) => {
    const { width: w, height: h } = src;
    const pw = w + 2 * r;
    const img = padEdge(src, r);
    const lum = padEdge(lumImage(src), r);
    const out = createImage(w, h);
    const n = (r + 1) * (r + 1);
    const mean = new Float64Array(16);
    const sigma = new Float64Array(4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let smin = Infinity;
        for (let q = 0; q < 4; q++) {
          const [dx, dy] = QUADRANTS[q]!;
          let c0 = 0, c1 = 0, c2 = 0, c3 = 0, sl = 0, sl2 = 0;
          for (let j = 0; j <= r; j++) {
            let k = (((y + r + dy * j) * pw) + x + r) * 4;
            for (let i = 0; i <= r; i++, k += dx * 4) {
              c0 += img[k]!;
              c1 += img[k + 1]!;
              c2 += img[k + 2]!;
              c3 += img[k + 3]!;
              const l = lum[k]!;
              sl += l;
              sl2 += l * l;
            }
          }
          const mu = sl / n;
          sigma[q] = Math.sqrt(Math.max(0, sl2 / n - mu * mu));
          mean[q * 4] = c0 / n;
          mean[q * 4 + 1] = c1 / n;
          mean[q * 4 + 2] = c2 / n;
          mean[q * 4 + 3] = c3 / n;
          smin = Math.min(smin, sigma[q]!);
        }
        let a0 = 0, a1 = 0, a2 = 0, a3 = 0, total = 0;
        for (let q = 0; q < 4; q++) {
          const wt = ((smin + EPS) / (sigma[q]! + EPS)) ** sharpness;
          a0 += wt * mean[q * 4]!;
          a1 += wt * mean[q * 4 + 1]!;
          a2 += wt * mean[q * 4 + 2]!;
          a3 += wt * mean[q * 4 + 3]!;
          total += wt;
        }
        const o = (y * w + x) * 4;
        out.data[o] = a0 / total;
        out.data[o + 1] = a1 / total;
        out.data[o + 2] = a2 / total;
        out.data[o + 3] = a3 / total;
      }
    return out;
  },
  tolerance: { abs: 2e-3, rel: 2e-3 },
  // RTX 40: 0.0044 at radius 1.
  hardwareTolerance: { abs: 4.5e-3, rel: 2e-3 },
});
