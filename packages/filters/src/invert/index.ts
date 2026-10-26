import { defineFilter, linearToSrgb, srgbToLinear } from '@rullino/core';

const inv = (x: number) => srgbToLinear(1 - Math.min(1, Math.max(0, linearToSrgb(x))));

/**
 * Negative image. Inverts in sRGB-encoded (perceptual) space so mid grey maps to itself,
 * matching what people expect from "invert"; values outside [0, 1] are clamped first.
 */
export const invert = defineFilter({
  id: 'invert',
  label: 'Invert',
  description: 'Swaps every colour for its opposite, like a photographic negative.',
  tryThis: 'Apply it twice and the original comes back.',
  category: 'classic',
  kind: 'pointwise',
  alpha: 'straight',
  params: {},
  wgsl: /* wgsl */ `
fn apply(c: vec4f, p: Params) -> vec4f {
  return vec4f(rl_srgb_to_linear(1.0 - clamp(rl_linear_to_srgb(c.rgb), vec3f(0.0), vec3f(1.0))), c.a);
}`,
  pixel: ([r, g, b, a]) => [inv(r), inv(g), inv(b), a],
  tolerance: { abs: 1e-4, rel: 2e-3 },
});
