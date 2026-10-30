import { createImage, defineFilter, linearToOklab, type LinearImage } from '@rullino/core';
import { clampLoad, q16 } from '../convolution';
import { expNegFast, padEdge } from '../fast';

/** Window radius for a spatial sigma: 2σ (weights beyond are below 2%), capped. */
const MAX_RADIUS = 40;
const radiusFor = (sigma: number) => Math.min(MAX_RADIUS, Math.ceil(2 * sigma));

/** OKLab of the straight colour in rgb, alpha in a (transparent pixels: L = a = b = 0). */
function labImage(src: LinearImage): LinearImage {
  const out = createImage(src.width, src.height);
  for (let i = 0; i < src.width * src.height; i++) {
    const a = src.data[i * 4 + 3]!;
    const lab = a > 0 ? linearToOklab(src.data[i * 4]! / a, src.data[i * 4 + 1]! / a, src.data[i * 4 + 2]! / a) : [0, 0, 0];
    out.data.set([...lab, a], i * 4);
  }
  return out;
}

/**
 * Edge-preserving smoothing: each neighbour weighs exp(−d²/2σs²) · exp(−ΔE²/2σr²), with ΔE the
 * OKLab distance of the straight colours plus the alpha difference, and the average is taken on
 * premultiplied linear values. Window radius 2σs (max 40 px). A first pass stores OKLab per pixel
 * (rgba16float, like the CPU's rounded intermediate) so the main pass needs no cube roots.
 */
export const bilateral = defineFilter({
  id: 'bilateral',
  label: 'Bilateral',
  description: 'Smooths flat areas while keeping edges sharp, by averaging only with neighbours of a similar colour.',
  tryThis: 'Raise the spatial sigma on a portrait for smooth skin, and keep the colour sigma low so edges stay crisp.',
  category: 'classic',
  kind: 'multipass',
  params: {
    sigmaSpace: { type: 'float', min: 0.5, max: 20, step: 0.1, default: 3, unit: 'px', label: 'Spatial sigma (px)', description: 'How far the smoothing reaches, in pixels.' },
    sigmaRange: { type: 'float', min: 0.01, max: 0.5, step: 0.005, default: 0.08, label: 'Colour sigma (ΔE)', description: 'How different in colour a neighbour may be and still be averaged in. Low keeps edges; high approaches a plain blur.' },
  },
  passes: [
    {
      name: 'lab',
      inputs: ['input'],
      wgsl: /* wgsl */ `
fn run(xy: vec2i, p: Params) -> vec4f {
  let c = load_input(xy);
  if (c.a <= 0.0) { return vec4f(0.0); }
  return vec4f(rl_linear_to_oklab(c.rgb / c.a), c.a);
}`,
    },
    {
      name: 'out',
      inputs: ['input', 'lab'],
      wgsl: /* wgsl */ `
fn run(xy: vec2i, p: Params) -> vec4f {
  let r = min(${MAX_RADIUS}, i32(ceil(2.0 * p.sigmaSpace)));
  let ks = -0.5 / (p.sigmaSpace * p.sigmaSpace);
  let kr = -0.5 / (p.sigmaRange * p.sigmaRange);
  let centre = load_lab(xy);
  var acc = vec4f(0.0);
  var total = 0.0;
  for (var dy = -r; dy <= r; dy++) {
    for (var dx = -r; dx <= r; dx++) {
      let d = vec2i(dx, dy);
      let e = load_lab(xy + d) - centre;
      let w = exp(f32(dx * dx + dy * dy) * ks + dot(e, e) * kr);
      acc += w * load_input(xy + d);
      total += w;
    }
  }
  return acc / total;
}`,
    },
  ],
  cpu: (src, { sigmaSpace, sigmaRange }) => {
    const lab = q16(labImage(src));
    const r = radiusFor(sigmaSpace);
    const ks = -0.5 / (sigmaSpace * sigmaSpace);
    const kr = -0.5 / (sigmaRange * sigmaRange);
    const out = createImage(src.width, src.height);
    for (let y = 0; y < src.height; y++)
      for (let x = 0; x < src.width; x++) {
        const acc = [0, 0, 0, 0];
        let total = 0;
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) {
            let e2 = 0;
            for (let c = 0; c < 4; c++) e2 += (clampLoad(lab, x + dx, y + dy, c) - clampLoad(lab, x, y, c)) ** 2;
            const w = Math.exp((dx * dx + dy * dy) * ks + e2 * kr);
            for (let c = 0; c < 4; c++) acc[c]! += w * clampLoad(src, x + dx, y + dy, c);
            total += w;
          }
        out.data.set(acc.map((v) => v / total), (y * src.width + x) * 4);
      }
    return out;
  },
  fast: (src, { sigmaSpace, sigmaRange }) => {
    const { width: w, height: h } = src;
    const r = radiusFor(sigmaSpace);
    const ks = -0.5 / (sigmaSpace * sigmaSpace);
    const kr = -0.5 / (sigmaRange * sigmaRange);
    const side = 2 * r + 1;
    const spatial = new Float64Array(side * side);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) spatial[(dy + r) * side + dx + r] = Math.exp((dx * dx + dy * dy) * ks);
    // Edge-replicated copies: the window needs no clamping in the inner loop.
    const lab = padEdge(q16(labImage(src)), r);
    const img = padEdge(src, r);
    const pw = w + 2 * r;
    const out = createImage(w, h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const c = ((y + r) * pw + x + r) * 4;
        const l0 = lab[c]!, l1 = lab[c + 1]!, l2 = lab[c + 2]!, l3 = lab[c + 3]!;
        let a0 = 0, a1 = 0, a2 = 0, a3 = 0, total = 0;
        for (let dy = 0; dy < side; dy++) {
          let j = ((y + dy) * pw + x) * 4;
          for (let dx = 0; dx < side; dx++, j += 4) {
            const e0 = lab[j]! - l0, e1 = lab[j + 1]! - l1, e2 = lab[j + 2]! - l2, e3 = lab[j + 3]! - l3;
            const wt = spatial[dy * side + dx]! * expNegFast((e0 * e0 + e1 * e1 + e2 * e2 + e3 * e3) * kr);
            a0 += wt * img[j]!;
            a1 += wt * img[j + 1]!;
            a2 += wt * img[j + 2]!;
            a3 += wt * img[j + 3]!;
            total += wt;
          }
        }
        const o = (y * w + x) * 4;
        out.data[o] = a0 / total;
        out.data[o + 1] = a1 / total;
        out.data[o + 2] = a2 / total;
        out.data[o + 3] = a3 / total;
      }
    return out;
  },
  tolerance: { abs: 1e-3, rel: 2e-3 },
});
