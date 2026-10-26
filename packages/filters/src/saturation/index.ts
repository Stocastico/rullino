import { defineFilter, linearToOklab, oklabToLinear } from '@rullino/core';
import { OKLAB_TOLERANCE } from '../shared';

/** Scales OKLab chroma by (1 + amount): -1 is fully desaturated, lightness is preserved. */
export const saturation = defineFilter({
  id: 'saturation',
  label: 'Saturation',
  description: 'Makes colours stronger or weaker, all by the same amount.',
  tryThis: 'Take it to the minimum for a grey picture, then bring it back to just under natural.',
  category: 'adjust',
  kind: 'pointwise',
  alpha: 'straight',
  params: {
    amount: { type: 'float', min: -1, max: 1, step: 0.01, default: 0, label: 'Amount', description: '-1 removes all colour, +1 doubles the colourfulness; 0 changes nothing.' },
  },
  wgsl: /* wgsl */ `
fn apply(c: vec4f, p: Params) -> vec4f {
  let lab = rl_linear_to_oklab(c.rgb);
  return vec4f(rl_oklab_to_linear(vec3f(lab.x, lab.yz * (1.0 + p.amount))), c.a);
}`,
  pixel: ([r, g, b, a], { amount }) => {
    const [L, A, B] = linearToOklab(r, g, b);
    const k = 1 + amount;
    return [...oklabToLinear(L, A * k, B * k), a];
  },
  tolerance: OKLAB_TOLERANCE,
});
