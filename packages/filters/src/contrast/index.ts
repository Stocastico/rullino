import { defineFilter, linearToOklab, oklabToLinear } from '@rullino/core';
import { mapOklab } from '../fast';
import { MID_GREY_L, OKLAB_TOLERANCE } from '../shared';

/**
 * Scales OKLab lightness around 18% grey by 2^amount; chroma (a, b) is untouched.
 * Lightness is floored at 0 so strong contrast cannot produce negative light.
 */
export const contrast = defineFilter({
  id: 'contrast',
  label: 'Contrast',
  description: 'Spreads tones apart (more contrast) or squeezes them together (less), around mid grey.',
  tryThis: 'Add some, then look at the histogram: the tones spread towards both ends.',
  preview: { amount: 0.6 },
  category: 'adjust',
  kind: 'pointwise',
  alpha: 'straight',
  params: {
    amount: { type: 'float', min: -1, max: 1, step: 0.01, default: 0, label: 'Amount', description: 'Negative flattens the picture, positive makes darks darker and lights lighter.' },
  },
  wgsl: /* wgsl */ `
fn apply(c: vec4f, p: Params) -> vec4f {
  let lab = rl_linear_to_oklab(c.rgb);
  let L = max(0.0, ${MID_GREY_L} + (lab.x - ${MID_GREY_L}) * exp2(p.amount));
  return vec4f(rl_oklab_to_linear(vec3f(L, lab.yz)), c.a);
}`,
  pixel: ([r, g, b, a], { amount }) => {
    const [L, A, B] = linearToOklab(r, g, b);
    const L2 = Math.max(0, MID_GREY_L + (L - MID_GREY_L) * 2 ** amount);
    return [...oklabToLinear(L2, A, B), a];
  },
  fast: (src, { amount }) => {
    return mapOklab(src, (L, a, b, o) => {
      o[0] = Math.max(0, MID_GREY_L + (L - MID_GREY_L) * 2 ** amount);
      o[1] = a;
      o[2] = b;
    });
  },
  tolerance: OKLAB_TOLERANCE,
});
