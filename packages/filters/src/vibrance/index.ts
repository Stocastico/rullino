import { defineFilter, linearToOklab, oklabToLinear } from '@rullino/core';
import { OKLAB_TOLERANCE } from '../shared';

/** OKLab chroma above which vibrance has no effect. sRGB primaries reach ~0.32. */
const FULL_CHROMA = 0.25;

/**
 * Saturation weighted towards muted colours: chroma is scaled by 1 + amount * w,
 * with w = 1 - C / FULL_CHROMA clamped to [0, 1]. Already vivid colours barely move.
 */
export const vibrance = defineFilter({
  id: 'vibrance',
  label: 'Vibrance',
  category: 'adjust',
  kind: 'pointwise',
  alpha: 'straight',
  params: {
    amount: { type: 'float', min: -1, max: 1, step: 0.01, default: 0, label: 'Amount' },
  },
  wgsl: /* wgsl */ `
fn apply(c: vec4f, p: Params) -> vec4f {
  let lab = rl_linear_to_oklab(c.rgb);
  let w = clamp(1.0 - length(lab.yz) / ${FULL_CHROMA}, 0.0, 1.0);
  return vec4f(rl_oklab_to_linear(vec3f(lab.x, lab.yz * (1.0 + p.amount * w))), c.a);
}`,
  pixel: ([r, g, b, a], { amount }) => {
    const [L, A, B] = linearToOklab(r, g, b);
    const w = Math.min(1, Math.max(0, 1 - Math.hypot(A, B) / FULL_CHROMA));
    const k = 1 + amount * w;
    return [...oklabToLinear(L, A * k, B * k), a];
  },
  tolerance: OKLAB_TOLERANCE,
});
