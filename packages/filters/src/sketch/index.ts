import { createImage, defineFilter, linearToSrgb, luminance, srgbToLinear } from '@rullino/core';
import { convolve1d, gaussianPass, gaussianWeights, q16 } from '../convolution';

/** Smallest blurred luminance divided by: keeps black areas from dividing by zero. */
const MIN_BLUR = 1e-3;

/**
 * Pencil sketch: colour dodge of the luminance by its blurred copy, min(1, L / blur(L))^darkness on
 * sRGB-encoded luminance (the classic "invert, blur, colour-dodge", since 1 − blur(1 − L) = blur(L)).
 * Flat areas become white paper, the dark side of every edge a grey line whose width follows σ.
 * Transparent pixels count as paper; alpha is kept.
 */
export const sketch = defineFilter({
  id: 'sketch',
  label: 'Sketch',
  description: 'Turns the picture into a pencil-like drawing by comparing each pixel with a blurred copy of the picture.',
  tryThis: 'Make the line width larger for bold strokes, then raise the darkness for a deeper drawing.',
  category: 'stylize',
  kind: 'multipass',
  params: {
    sigma: { type: 'float', min: 0.5, max: 20, step: 0.1, default: 3, unit: 'px', label: 'Line width σ (px)', description: 'Thickness of the lines in pixels.' },
    darkness: { type: 'float', min: 0.5, max: 4, step: 0.01, default: 1.5, label: 'Darkness', description: 'How dark the lines get; higher looks more like heavy pencil.' },
  },
  passes: [
    {
      name: 'lum',
      inputs: ['input'],
      wgsl: /* wgsl */ `
fn run(xy: vec2i, p: Params) -> vec4f {
  let s = load_input(xy);
  var l = 1.0;
  if (s.a > 0.0) {
    l = rl_linear_to_srgb(vec3f(rl_luminance(s.rgb / s.a))).x;
  }
  return vec4f(l);
}`,
    },
    gaussianPass('h', 'lum', 'x'),
    gaussianPass('v', 'h', 'y'),
    {
      name: 'out',
      inputs: ['input', 'lum', 'v'],
      wgsl: /* wgsl */ `
fn run(xy: vec2i, p: Params) -> vec4f {
  let l = load_lum(xy).x;
  let b = max(load_v(xy).x, ${MIN_BLUR});
  let e = pow(min(1.0, max(l, 0.0) / b), p.darkness);
  let a = load_input(xy).a;
  return vec4f(rl_srgb_to_linear(vec3f(e)) * a, a);
}`,
    },
  ],
  cpu: (src, { sigma, darkness }) => {
    // The GPU stores the luminance and both blur passes as half floats: round them the same way
    // (the division and the darkness exponent amplify the difference).
    const L = createImage(src.width, src.height);
    for (let i = 0; i < src.data.length; i += 4) {
      const a = src.data[i + 3]!;
      const l = a > 0 ? linearToSrgb(luminance(src.data[i]! / a, src.data[i + 1]! / a, src.data[i + 2]! / a)) : 1;
      L.data.set([l, l, l, l], i);
    }
    const lum = q16(L);
    const w = gaussianWeights(sigma);
    const blur = q16(convolve1d(q16(convolve1d(lum, w, 'x')), w, 'y'));
    const out = createImage(src.width, src.height);
    for (let i = 0; i < src.data.length; i += 4) {
      const e = Math.min(1, Math.max(lum.data[i]!, 0) / Math.max(blur.data[i]!, MIN_BLUR)) ** darkness;
      const a = src.data[i + 3]!;
      const v = srgbToLinear(e) * a;
      out.data.set([v, v, v, a], i);
    }
    return out;
  },
  tolerance: { abs: 2e-3, rel: 4e-3 },
  // RTX 40: 0.0134 at darkness 4 (the exponent amplifies the division's error).
  hardwareTolerance: { abs: 1.2e-2, rel: 4e-3 },
});
