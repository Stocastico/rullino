import { defineFilter, linearToSrgb, srgbToLinear } from '@rullino/core';

const quantise = (x: number, n: number) => {
  const e = Math.min(1, Math.max(0, linearToSrgb(x)));
  // floor(v + 0.5) rather than Math.round / WGSL round(), which disagree on ties.
  return srgbToLinear(Math.floor(e * (n - 1) + 0.5) / (n - 1));
};

/** Quantises each channel to `levels` evenly spaced steps in sRGB-encoded (perceptual) space. */
export const posterize = defineFilter({
  id: 'posterize',
  label: 'Posterize',
  category: 'classic',
  kind: 'pointwise',
  alpha: 'straight',
  params: {
    levels: { type: 'int', min: 2, max: 32, default: 4, label: 'Levels' },
  },
  wgsl: /* wgsl */ `
fn apply(c: vec4f, p: Params) -> vec4f {
  let n = f32(p.levels - 1);
  let e = clamp(rl_linear_to_srgb(c.rgb), vec3f(0.0), vec3f(1.0));
  return vec4f(rl_srgb_to_linear(floor(e * n + 0.5) / n), c.a);
}`,
  pixel: ([r, g, b, a], { levels }) => [quantise(r, levels), quantise(g, levels), quantise(b, levels), a],
  tolerance: { abs: 1e-4, rel: 2e-3 },
});
