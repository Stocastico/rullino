import { defineFilter, linearToOklab, oklabToLinear } from '@rullino/core';
import { mapOklab } from '../fast';
import { OKLAB_TOLERANCE } from '../shared';

/**
 * Black point on OKLab lightness: L' = max(0, (L − b) / (1 − b)). A positive amount crushes
 * shadows to black, a negative one lifts black to a faded grey; white stays put. Hue and chroma
 * are untouched.
 */
export const blackPoint = defineFilter({
  id: 'blackPoint',
  label: 'Black point',
  description: 'Sets how dark the darkest tones are: raising the black point deepens shadows, lowering it lifts them into a faded look.',
  tryThis: 'Lower it slightly for a matte, filmic shadow, or raise it to make blacks richer.',
  preview: { amount: 0.12 },
  category: 'adjust',
  kind: 'pointwise',
  alpha: 'straight',
  params: {
    amount: { type: 'float', min: -0.2, max: 0.2, step: 0.005, default: 0, label: 'Amount', description: 'Positive values crush the shadows towards black; negative values lift them.' },
  },
  wgsl: /* wgsl */ `
fn apply(c: vec4f, p: Params) -> vec4f {
  let lab = rl_linear_to_oklab(c.rgb);
  let L = max(0.0, (lab.x - p.amount) / (1.0 - p.amount));
  return vec4f(rl_oklab_to_linear(vec3f(L, lab.yz)), c.a);
}`,
  pixel: ([r, g, b, a], { amount }) => {
    const [L, A, B] = linearToOklab(r, g, b);
    return [...oklabToLinear(Math.max(0, (L - amount) / (1 - amount)), A, B), a];
  },
  fast: (src, { amount }) => {
    return mapOklab(src, (L, a, b, o) => {
      o[0] = Math.max(0, (L - amount) / (1 - amount));
      o[1] = a;
      o[2] = b;
    });
  },
  tolerance: OKLAB_TOLERANCE,
});
