import { createImage, defineFilter, luminance, type LinearImage } from '@rullino/core';
import { convolve1d, gaussianPass, gaussianReach, gaussianWeights, q16 } from '../convolution';
import { convolve1dFast } from '../fast';

/** Half-width of the soft knee around the threshold (in linear luminance). */
const KNEE = 0.1;

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * Glow around bright areas: the parts brighter than `threshold` (linear luminance of the
 * premultiplied colour, soft knee ±0.1) are blurred with σ and added back as light, × intensity.
 * Works on linear light, so HDR highlights bloom more; alpha grows with the glow, up to 1.
 */
export const bloom = defineFilter({
  id: 'bloom',
  label: 'Bloom',
  description: 'Adds a soft glow around the bright parts of the picture, as if light were bleeding in the lens.',
  tryThis: 'Lower the threshold until only the lights glow, then widen the radius for a dreamy look.',
  category: 'stylize',
  kind: 'multipass',
  params: {
    threshold: { type: 'float', min: 0, max: 2, step: 0.01, default: 0.7, label: 'Threshold', description: 'Only light brighter than this glows (in linear light, so 1 is white).' },
    sigma: { type: 'float', min: 0.5, max: 60, step: 0.5, default: 12, unit: 'px', label: 'Radius σ (px)', description: 'How far the glow spreads, in pixels.' },
    intensity: { type: 'float', min: 0, max: 2, step: 0.01, default: 0.6, label: 'Intensity', description: 'How strong the glow is when added back.' },
  },
  passes: [
    {
      name: 'bright',
      inputs: ['input'],
      wgsl: /* wgsl */ `
fn run(xy: vec2i, p: Params) -> vec4f {
  let c = load_input(xy);
  return c * smoothstep(p.threshold - ${KNEE}, p.threshold + ${KNEE}, rl_luminance(c.rgb));
}`,
    },
    gaussianPass('h', 'bright', 'x'),
    gaussianPass('v', 'h', 'y'),
    {
      name: 'out',
      inputs: ['input', 'v'],
      wgsl: /* wgsl */ `
fn run(xy: vec2i, p: Params) -> vec4f {
  let c = load_input(xy) + p.intensity * load_v(xy);
  return vec4f(c.rgb, min(c.a, 1.0));
}`,
    },
  ],
  reach: ({ sigma }) => gaussianReach(sigma),
  cpu: (src, { threshold, sigma, intensity }) => {
    // Intermediates rounded to half floats, as the GPU stores them.
    const bright: LinearImage = createImage(src.width, src.height);
    for (let i = 0; i < src.data.length; i += 4) {
      const w = smoothstep(threshold - KNEE, threshold + KNEE, luminance(src.data[i]!, src.data[i + 1]!, src.data[i + 2]!));
      for (let c = 0; c < 4; c++) bright.data[i + c] = src.data[i + c]! * w;
    }
    const k = gaussianWeights(sigma);
    const glow = q16(convolve1d(q16(convolve1d(q16(bright), k, 'x')), k, 'y'));
    const out = createImage(src.width, src.height);
    for (let i = 0; i < src.data.length; i += 4) {
      for (let c = 0; c < 3; c++) out.data[i + c] = src.data[i + c]! + intensity * glow.data[i + c]!;
      out.data[i + 3] = Math.min(1, src.data[i + 3]! + intensity * glow.data[i + 3]!);
    }
    return out;
  },
  fast: (src, { threshold, sigma, intensity }) => {
    const { data: s } = src;
    const bright = createImage(src.width, src.height);
    for (let i = 0; i < s.length; i += 4) {
      const w = smoothstep(threshold - KNEE, threshold + KNEE, luminance(s[i]!, s[i + 1]!, s[i + 2]!));
      bright.data[i] = s[i]! * w;
      bright.data[i + 1] = s[i + 1]! * w;
      bright.data[i + 2] = s[i + 2]! * w;
      bright.data[i + 3] = s[i + 3]! * w;
    }
    const k = gaussianWeights(sigma);
    const glow = q16(convolve1dFast(q16(convolve1dFast(q16(bright), k, 'x')), k, 'y')).data;
    const out = createImage(src.width, src.height);
    for (let i = 0; i < s.length; i += 4) {
      out.data[i] = s[i]! + intensity * glow[i]!;
      out.data[i + 1] = s[i + 1]! + intensity * glow[i + 1]!;
      out.data[i + 2] = s[i + 2]! + intensity * glow[i + 2]!;
      out.data[i + 3] = Math.min(1, s[i + 3]! + intensity * glow[i + 3]!);
    }
    return out;
  },
  tolerance: { abs: 2e-3, rel: 2e-3 },
});
