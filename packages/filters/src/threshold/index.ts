import { defineFilter, linearToSrgb, luminance } from '@rullino/core';

/**
 * Binary threshold on luminance. `level` is in sRGB-encoded (perceptual) units, so 0.5 means
 * "middle of the slider" rather than 50% linear light. Output is black or white, alpha kept.
 */
export const threshold = defineFilter({
  id: 'threshold',
  label: 'Threshold',
  description: 'Turns the picture into pure black and white: pixels brighter than the level become white.',
  tryThis: 'Slide the level and watch the picture become a stencil.',
  category: 'classic',
  kind: 'pointwise',
  alpha: 'straight',
  params: {
    level: { type: 'float', min: 0, max: 1, step: 0.01, default: 0.5, label: 'Level', description: 'The brightness cut-off. Higher values leave less white.' },
    invert: { type: 'bool', default: false, label: 'Invert', description: 'Swap black and white.' },
  },
  wgsl: /* wgsl */ `
fn apply(c: vec4f, p: Params) -> vec4f {
  let e = rl_linear_to_srgb(vec3f(rl_luminance(c.rgb))).x;
  let on = (e >= p.level) != (p.invert == 1u);
  return vec4f(vec3f(select(0.0, 1.0, on)), c.a);
}`,
  pixel: ([r, g, b, a], { level, invert }) => {
    const v = linearToSrgb(luminance(r, g, b)) >= level !== invert ? 1 : 0;
    return [v, v, v, a];
  },
  tolerance: { abs: 0, rel: 0 },
});
