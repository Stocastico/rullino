import { defineFilter } from '@rullino/core';

const mix = (label: string, def: number) => ({ type: 'float', min: -2, max: 2, step: 0.01, default: def, label }) as const;

/**
 * Each output channel as a weighted sum of the input channels, on linear light. Linear in colour,
 * so it works on premultiplied values directly.
 */
export const channelMixer = defineFilter({
  id: 'channelMixer',
  label: 'Channel mixer',
  category: 'adjust',
  kind: 'pointwise',
  alpha: 'premultiplied',
  params: {
    rr: mix('Red from red', 1),
    rg: mix('Red from green', 0),
    rb: mix('Red from blue', 0),
    gr: mix('Green from red', 0),
    gg: mix('Green from green', 1),
    gb: mix('Green from blue', 0),
    br: mix('Blue from red', 0),
    bg: mix('Blue from green', 0),
    bb: mix('Blue from blue', 1),
  },
  wgsl: /* wgsl */ `
fn apply(c: vec4f, p: Params) -> vec4f {
  return vec4f(
    p.rr * c.r + p.rg * c.g + p.rb * c.b,
    p.gr * c.r + p.gg * c.g + p.gb * c.b,
    p.br * c.r + p.bg * c.g + p.bb * c.b,
    c.a,
  );
}`,
  pixel: ([r, g, b, a], p) => [p.rr * r + p.rg * g + p.rb * b, p.gr * r + p.gg * g + p.gb * b, p.br * r + p.bg * g + p.bb * b, a],
  tolerance: { abs: 1e-3, rel: 2e-3 },
});
