import { defineFilter } from '@rullino/core';

const mix = (group: string, label: string, def: number) => ({ type: 'float', min: -2, max: 2, step: 0.01, default: def, label, group, description: `How much of the input ${label.slice(5)} goes into the ${group.toLowerCase()}.` }) as const;

/**
 * Each output channel as a weighted sum of the input channels, on linear light. Linear in colour,
 * so it works on premultiplied values directly.
 */
export const channelMixer = defineFilter({
  id: 'channelMixer',
  label: 'Channel mixer',
  description: 'Builds each output colour channel from a weighted mix of the input channels, on linear light.',
  tryThis: 'Feed some red into the blue output for a surreal colour swap, or set the red output to 0.3 / 0.6 / 0.1 for a classic black-and-white look.',
  category: 'adjust',
  kind: 'pointwise',
  alpha: 'premultiplied',
  params: {
    rr: mix('Red output', 'From red', 1),
    rg: mix('Red output', 'From green', 0),
    rb: mix('Red output', 'From blue', 0),
    gr: mix('Green output', 'From red', 0),
    gg: mix('Green output', 'From green', 1),
    gb: mix('Green output', 'From blue', 0),
    br: mix('Blue output', 'From red', 0),
    bg: mix('Blue output', 'From green', 0),
    bb: mix('Blue output', 'From blue', 1),
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
