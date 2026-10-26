import { defineFilter, linearToOklab, oklabToLinear } from '@rullino/core';
import { OKLAB_TOLERANCE } from '../shared';

const tone = (L: number, s: number, h: number) => {
  const l = Math.min(1, Math.max(0, L));
  return L + s * l * (1 - l) ** 2 + h * l * l * (1 - l);
};

/**
 * Global shadows / highlights on OKLab lightness: L' = L + s·L(1−L)² + h·L²(1−L), with L clamped
 * to [0, 1] inside the weights. The shadow term peaks at L = 1/3, the highlight term at 2/3;
 * black, white and HDR values above white do not move, and the curve stays monotone for
 * |s|, |h| ≤ 1. (A local, detail-preserving version is tier B "brilliance".)
 */
export const shadowsHighlights = defineFilter({
  id: 'shadowsHighlights',
  label: 'Shadows / highlights',
  description: 'Recovers detail in dark and bright areas by lightening shadows or darkening highlights.',
  tryThis: 'Lift the shadows of a backlit portrait, then pull the highlights down a little to recover the sky.',
  preview: { shadows: 0.7, highlights: -0.5 },
  category: 'adjust',
  kind: 'pointwise',
  alpha: 'straight',
  params: {
    shadows: { type: 'float', min: -1, max: 1, step: 0.01, default: 0, label: 'Shadows', description: 'Positive lightens dark areas, negative deepens them.' },
    highlights: { type: 'float', min: -1, max: 1, step: 0.01, default: 0, label: 'Highlights', description: 'Negative darkens bright areas, positive brightens them.' },
  },
  wgsl: /* wgsl */ `
fn apply(c: vec4f, p: Params) -> vec4f {
  let lab = rl_linear_to_oklab(c.rgb);
  let l = clamp(lab.x, 0.0, 1.0);
  let L = lab.x + p.shadows * l * (1.0 - l) * (1.0 - l) + p.highlights * l * l * (1.0 - l);
  return vec4f(rl_oklab_to_linear(vec3f(L, lab.yz)), c.a);
}`,
  pixel: ([r, g, b, a], { shadows, highlights }) => {
    const [L, A, B] = linearToOklab(r, g, b);
    return [...oklabToLinear(tone(L, shadows, highlights), A, B), a];
  },
  tolerance: OKLAB_TOLERANCE,
});
