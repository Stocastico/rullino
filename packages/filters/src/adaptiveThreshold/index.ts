import { createImage, defineFilter, linearToSrgb, luminance } from '@rullino/core';
import { convolve1d, gaussianPass, gaussianReach, gaussianWeights, q16 } from '../convolution';
import { convolve1dFast } from '../fast';

/**
 * Adaptive (local) threshold, as OpenCV's ADAPTIVE_THRESH_GAUSSIAN_C: a pixel is white when its
 * perceptual luminance exceeds the Gaussian-weighted local mean minus `offset`. Works under
 * uneven lighting where a single global threshold cannot. Alpha kept.
 */
export const adaptiveThreshold = defineFilter({
  id: 'adaptiveThreshold',
  label: 'Adaptive threshold',
  description: 'Turns the picture into black and white by comparing each pixel with the average of its surroundings, so it copes with uneven lighting.',
  tryThis: 'Try it on a photographed page with a shadow across it, where a plain Threshold fails.',
  category: 'classic',
  kind: 'multipass',
  params: {
    sigma: { type: 'float', min: 0.5, max: 50, step: 0.1, default: 8, unit: 'px', label: 'Neighbourhood σ (px)', description: 'How far around each pixel the local average reaches. Larger values suit bigger shapes.' },
    offset: { type: 'float', min: -0.5, max: 0.5, step: 0.005, default: 0.02, label: 'Offset C', description: 'A pixel turns white when it is brighter than its local average minus this value. Raise it for more white; lower it to remove speckles.' },
    invert: { type: 'bool', default: false, label: 'Invert', description: 'Swap black and white.' },
  },
  passes: [
    {
      name: 'lum',
      inputs: ['input'],
      wgsl: /* wgsl */ `
fn run(xy: vec2i, p: Params) -> vec4f {
  let v = rl_linear_to_srgb(vec3f(rl_luminance(rl_unpremultiply(load_input(xy)).rgb))).x;
  return vec4f(v, v, v, 1.0);
}`,
    },
    gaussianPass('h', 'lum', 'x'),
    gaussianPass('v', 'h', 'y'),
    {
      name: 'out',
      inputs: ['input', 'lum', 'v'],
      wgsl: /* wgsl */ `
fn run(xy: vec2i, p: Params) -> vec4f {
  let a = load_input(xy).a;
  let on = (load_lum(xy).r > load_v(xy).r - p.offset) != (p.invert == 1u);
  let v = select(0.0, a, on);
  return vec4f(v, v, v, a);
}`,
    },
  ],
  reach: ({ sigma }) => gaussianReach(sigma),
  cpu: (src, { sigma, offset, invert }) => {
    // Mirrors the passes, rounding intermediates to f16 like the GPU textures.
    const lum = createImage(src.width, src.height);
    for (let i = 0; i < src.data.length; i += 4) {
      const a = src.data[i + 3]!;
      const k = a > 0 ? 1 / a : 0;
      const v = linearToSrgb(luminance(src.data[i]! * k, src.data[i + 1]! * k, src.data[i + 2]! * k));
      lum.data.set([v, v, v, 1], i);
    }
    const l = q16(lum);
    const w = gaussianWeights(sigma);
    const mean = q16(convolve1d(q16(convolve1d(l, w, 'x')), w, 'y'));
    const out = createImage(src.width, src.height);
    for (let i = 0; i < src.data.length; i += 4) {
      const a = src.data[i + 3]!;
      const v = l.data[i]! > mean.data[i]! - offset !== invert ? a : 0;
      out.data.set([v, v, v, a], i);
    }
    return out;
  },
  fast: (src, { sigma, offset, invert }) => {
    const { data: s } = src;
    const lum = createImage(src.width, src.height);
    for (let i = 0; i < s.length; i += 4) {
      const a = s[i + 3]!;
      const k = a > 0 ? 1 / a : 0;
      lum.data[i] = lum.data[i + 1] = lum.data[i + 2] = linearToSrgb(luminance(s[i]! * k, s[i + 1]! * k, s[i + 2]! * k));
      lum.data[i + 3] = 1;
    }
    const l = q16(lum).data;
    const w = gaussianWeights(sigma);
    const mean = q16(convolve1dFast(q16(convolve1dFast(q16(lum), w, 'x')), w, 'y')).data;
    const out = createImage(src.width, src.height);
    for (let i = 0; i < s.length; i += 4) {
      const a = s[i + 3]!;
      const v = l[i]! > mean[i]! - offset !== invert ? a : 0;
      out.data[i] = out.data[i + 1] = out.data[i + 2] = v;
      out.data[i + 3] = a;
    }
    return out;
  },
  tolerance: { abs: 0, rel: 0, outliers: 0.002 },
});
