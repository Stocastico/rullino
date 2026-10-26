import { defineFilter, linearToSrgb, srgbToLinear } from '@rullino/core';

/**
 * Narrowest input range: one 8-bit step. A collapsed range then acts as a very steep ramp instead
 * of amplifying float rounding by 10^4 (which also made GPU and CPU disagree).
 */
const MIN_RANGE = 1 / 255;

const level = (e: number, inBlack: number, inWhite: number, gamma: number, outBlack: number, outWhite: number) => {
  const t = Math.min(1, Math.max(0, (e - inBlack) / Math.max(inWhite - inBlack, MIN_RANGE)));
  return outBlack + t ** (1 / gamma) * (outWhite - outBlack);
};

/**
 * Classic levels per channel in sRGB-encoded units: input black/white points stretch the range
 * and clip outside it, gamma bends the midtones, output black/white compress the result. Like any
 * levels tool it is an LDR operation: values above white (HDR) are clipped to the output white,
 * even at the defaults. (Leaving the top unclipped made narrow input ranges blow values past the
 * float16 range.)
 */
export const levels = defineFilter({
  id: 'levels',
  label: 'Levels',
  description: 'Maps a range of input tones to a range of output tones: set the black and white points, then adjust the midtones.',
  tryThis: 'Move Input black and Input white towards the edges of the histogram, then use the midtone gamma to set the mood.',
  category: 'adjust',
  kind: 'pointwise',
  alpha: 'straight',
  params: {
    inBlack: { type: 'float', min: 0, max: 1, step: 0.005, default: 0, label: 'Input black', description: 'Input tones at or below this become black.' },
    inWhite: { type: 'float', min: 0, max: 1, step: 0.005, default: 1, label: 'Input white', description: 'Input tones at or above this become white.' },
    gamma: { type: 'float', min: 0.1, max: 10, step: 0.01, default: 1, label: 'Gamma (midtones)', description: 'Above 1 lightens the midtones, below 1 darkens them.' },
    outBlack: { type: 'float', min: 0, max: 1, step: 0.005, default: 0, label: 'Output black', description: 'Black is raised to this level: a higher value gives a faded look.' },
    outWhite: { type: 'float', min: 0, max: 1, step: 0.005, default: 1, label: 'Output white', description: 'White is lowered to this level.' },
  },
  wgsl: /* wgsl */ `
fn apply(c: vec4f, p: Params) -> vec4f {
  let e = rl_linear_to_srgb(c.rgb);
  let t = clamp((e - p.inBlack) / max(p.inWhite - p.inBlack, ${MIN_RANGE}), vec3f(0.0), vec3f(1.0));
  let o = p.outBlack + pow(t, vec3f(1.0 / p.gamma)) * (p.outWhite - p.outBlack);
  return vec4f(rl_srgb_to_linear(o), c.a);
}`,
  pixel: ([r, g, b, a], p) => {
    const f = (x: number) => srgbToLinear(level(linearToSrgb(x), p.inBlack, p.inWhite, p.gamma, p.outBlack, p.outWhite));
    return [f(r), f(g), f(b), a];
  },
  tolerance: { abs: 2e-4, rel: 2e-3 },
});
