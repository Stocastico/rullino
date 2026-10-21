import { defineFilter } from '@rullino/core';

/** Exposure in stops: scales linear light by 2^ev. Works on premultiplied colour directly. */
export const exposure = defineFilter({
  id: 'exposure',
  label: 'Exposure',
  category: 'adjust',
  kind: 'pointwise',
  alpha: 'premultiplied',
  params: {
    ev: { type: 'float', min: -5, max: 5, step: 0.05, default: 0, label: 'EV' },
  },
  wgsl: /* wgsl */ `
fn apply(c: vec4f, p: Params) -> vec4f {
  return vec4f(c.rgb * exp2(p.ev), c.a);
}`,
  pixel: ([r, g, b, a], { ev }) => {
    const k = 2 ** ev;
    return [r * k, g * k, b * k, a];
  },
  // Output is rounded to half precision (relative step 2^-11); allow one ulp plus exp2 slack.
  tolerance: { abs: 1e-7, rel: 2 ** -10 },
});
