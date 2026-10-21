import { defineFilter } from '@rullino/core';

const pow = (x: number, e: number) => Math.sign(x) * Math.abs(x) ** e;

/** Classic per-channel gamma on straight linear colour: x' = x^(1/gamma), sign-mirrored. */
export const gamma = defineFilter({
  id: 'gamma',
  label: 'Gamma',
  category: 'adjust',
  kind: 'pointwise',
  alpha: 'straight',
  params: {
    gamma: { type: 'float', min: 0.2, max: 5, step: 0.01, default: 1, label: 'Gamma' },
  },
  wgsl: /* wgsl */ `
fn apply(c: vec4f, p: Params) -> vec4f {
  return vec4f(sign(c.rgb) * pow(abs(c.rgb), vec3f(1.0 / p.gamma)), c.a);
}`,
  pixel: ([r, g, b, a], p) => {
    const e = 1 / p.gamma;
    return [pow(r, e), pow(g, e), pow(b, e), a];
  },
  tolerance: { abs: 1e-4, rel: 2e-3 },
});
