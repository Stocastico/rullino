import { createImage, defineFilter, type LinearImage } from '@rullino/core';
import { gaussianCpu, gaussianPass, q16 } from '../convolution';

/** Below this blurred known-weight a pixel is too far from any known pixel to estimate. */
const MIN_WEIGHT = 1e-3;

/** num / den per pixel (den's first channel), then mix(input, estimate, m). */
function fillCpu(src: LinearImage, num: LinearImage, den: LinearImage, mask: Float32Array): LinearImage {
  const out = createImage(src.width, src.height);
  for (let i = 0; i < mask.length; i++) {
    const d = Math.max(den.data[i * 4]!, MIN_WEIGHT);
    for (let c = 0; c < 4; c++) out.data[i * 4 + c] = src.data[i * 4 + c]! + (num.data[i * 4 + c]! / d - src.data[i * 4 + c]!) * mask[i]!;
  }
  return out;
}

/** One Jacobi step: inside the mask, the mean of the 4 neighbours of `cur` (clamped to the edge). */
function diffuseCpu(cur: LinearImage, src: LinearImage, mask: Float32Array): LinearImage {
  const { width: w, height: h } = cur;
  const out = createImage(w, h);
  const at = (x: number, y: number, c: number) => cur.data[(Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4 + c]!;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 4; c++) {
        const i = (y * w + x) * 4 + c;
        const v = 0.25 * (at(x - 1, y, c) + at(x + 1, y, c) + at(x, y - 1, c) + at(x, y + 1, c));
        out.data[i] = src.data[i]! + (v - src.data[i]!) * mask[y * w + x]!;
      }
  return out;
}

/**
 * Removes small objects: rebuilds the masked area from its surroundings. A first estimate comes
 * from normalised convolution (Gaussian of the known pixels / Gaussian of their weights), then
 * `iterations` diffusion steps smooth it towards a harmonic fill. Good for blemishes, wires and
 * small objects on smooth backgrounds; textures are not reproduced (that needs patch-based
 * inpainting). Holes wider than about 3σ get no estimate in their middle.
 */
export const inpaint = defineFilter({
  id: 'inpaint',
  label: 'Remove (inpaint)',
  tryThis: 'Paint a thin scratch or a wire, and watch it disappear; use a larger reach for wider areas.',
  description: 'Paint a mask over what to remove; it is rebuilt from the surrounding pixels. For wider areas, raise the reach to at least half their width.',
  category: 'classic',
  kind: 'multipass',
  usesMask: true,
  params: {
    sigma: { type: 'float', min: 1, max: 100, step: 0.5, default: 12, unit: 'px', label: 'Reach (px)', description: 'How far into the surroundings the fill reaches, in pixels. Use at least half the width of the area you remove.' },
    iterations: { type: 'int', min: 0, max: 400, default: 30, label: 'Smoothing iterations', description: 'Smoothing rounds applied to the fill. More is smoother but slower.' },
  },
  passes: [
    { name: 'num', inputs: ['input', 'mask'], wgsl: 'fn run(xy: vec2i, p: Params) -> vec4f { return load_input(xy) * (1.0 - load_mask(xy).r); }' },
    { name: 'den', inputs: ['mask'], wgsl: 'fn run(xy: vec2i, p: Params) -> vec4f { return vec4f(1.0 - load_mask(xy).r); }' },
    gaussianPass('numH', 'num', 'x'),
    gaussianPass('numV', 'numH', 'y'),
    gaussianPass('denH', 'den', 'x'),
    gaussianPass('denV', 'denH', 'y'),
    {
      name: 'fill',
      inputs: ['input', 'mask', 'numV', 'denV'],
      wgsl: /* wgsl */ `
fn run(xy: vec2i, p: Params) -> vec4f {
  let c = load_input(xy);
  return c + (load_numV(xy) / max(load_denV(xy).r, ${MIN_WEIGHT}) - c) * load_mask(xy).r;
}`,
    },
    {
      name: 'diffuse',
      inputs: ['fill', 'input', 'mask'],
      repeat: 'iterations',
      wgsl: /* wgsl */ `
fn run(xy: vec2i, p: Params) -> vec4f {
  let c = load_input(xy);
  let m = load_mask(xy).r;
  // Outside the hole the result is the input: skip the four neighbour loads (most pixels).
  if (m <= 0.0) { return c; }
  let v = 0.25 * (load_fill(xy - vec2i(1, 0)) + load_fill(xy + vec2i(1, 0)) + load_fill(xy - vec2i(0, 1)) + load_fill(xy + vec2i(0, 1)));
  return c + (v - c) * m;
}`,
    },
  ],
  cpu: (src, { sigma, iterations }, mask) => {
    const m = mask!;
    const weighted = (f: (i: number, c: number) => number) => {
      const img = createImage(src.width, src.height);
      for (let i = 0; i < m.length; i++) for (let c = 0; c < 4; c++) img.data[i * 4 + c] = f(i, c);
      return q16(img);
    };
    // Every GPU pass writes an rgba16float texture: round each intermediate the same way.
    const num = weighted((i, c) => src.data[i * 4 + c]! * (1 - m[i]!));
    const den = weighted((i) => 1 - m[i]!);
    let cur = q16(fillCpu(src, q16(gaussianCpu(num, sigma)), q16(gaussianCpu(den, sigma)), m));
    for (let k = 0; k < iterations; k++) cur = q16(diffuseCpu(cur, src, m));
    return cur;
  },
  tolerance: { abs: 2e-3, rel: 4e-3 },
});
