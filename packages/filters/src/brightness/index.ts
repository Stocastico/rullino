import { defineFilter, linearToOklab, oklabToLinear } from '@rullino/core';
import { mapOklab } from '../fast';
import { OKLAB_TOLERANCE } from '../shared';

/**
 * Midtone brightness: a power curve on OKLab lightness, L' = L^(2^-amount).
 * Black (L = 0) and white (L = 1) stay put; hue and chroma are untouched.
 * Unlike `gamma`, which bends each linear RGB channel independently.
 */
export const brightness = defineFilter({
  id: 'brightness',
  label: 'Brightness',
  description: 'Makes the picture lighter or darker while keeping the colours as they are (unlike Exposure, it works on perceived lightness).',
  tryThis: 'Push it up and compare with Exposure: brightness leaves hue and colourfulness alone.',
  preview: { amount: 0.5 },
  category: 'adjust',
  kind: 'pointwise',
  alpha: 'straight',
  params: {
    amount: { type: 'float', min: -1, max: 1, step: 0.01, default: 0, label: 'Amount', description: 'Negative darkens, positive lightens; 0 changes nothing.' },
  },
  wgsl: /* wgsl */ `
fn apply(c: vec4f, p: Params) -> vec4f {
  let lab = rl_linear_to_oklab(c.rgb);
  let L = pow(max(lab.x, 0.0), exp2(-p.amount));
  return vec4f(rl_oklab_to_linear(vec3f(L, lab.yz)), c.a);
}`,
  pixel: ([r, g, b, a], { amount }) => {
    const [L, A, B] = linearToOklab(r, g, b);
    return [...oklabToLinear(Math.max(L, 0) ** (2 ** -amount), A, B), a];
  },
  fast: (src, { amount }) => {
    return mapOklab(src, (L, a, b, o) => {
      o[0] = Math.max(L, 0) ** (2 ** -amount);
      o[1] = a;
      o[2] = b;
    });
  },
  tolerance: OKLAB_TOLERANCE,
});
