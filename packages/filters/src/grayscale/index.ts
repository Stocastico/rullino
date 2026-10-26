import { defineFilter, luminance } from '@rullino/core';

const mix = (x: number, y: number, t: number) => x + (y - x) * t;

/**
 * Grey from linear RGB: Rec. 709 luminance (physically right), channel average or channel max.
 * All three are linear in colour, so they run on premultiplied values directly.
 */
export const grayscale = defineFilter({
  id: 'grayscale',
  label: 'Grayscale',
  description: 'Removes colour, keeping only brightness.',
  tryThis: 'Compare Luminance, Average and Max on a picture with a strong red or blue.',
  category: 'classic',
  kind: 'pointwise',
  alpha: 'premultiplied',
  params: {
    method: {
      type: 'enum',
      options: { luminance: 'Luminance (Rec. 709)', average: 'Average', max: 'Max' },
      default: 'luminance',
      label: 'Method',
      description: 'How brightness is computed. Luminance weighs colours like the eye does, Average takes the mean, Max takes the brightest channel.',
    },
    amount: { type: 'float', min: 0, max: 1, step: 0.01, default: 1, label: 'Amount', description: 'Blend between the original colour (0) and full grayscale (1).' },
  },
  wgsl: /* wgsl */ `
fn apply(c: vec4f, p: Params) -> vec4f {
  var y: f32;
  switch p.method {
    case 0u: { y = rl_luminance(c.rgb); }
    case 1u: { y = (c.r + c.g + c.b) / 3.0; }
    default: { y = max(c.r, max(c.g, c.b)); }
  }
  return vec4f(mix(c.rgb, vec3f(y), p.amount), c.a);
}`,
  pixel: ([r, g, b, a], { method, amount }) => {
    const y = method === 'luminance' ? luminance(r, g, b) : method === 'average' ? (r + g + b) / 3 : Math.max(r, g, b);
    return [mix(r, y, amount), mix(g, y, amount), mix(b, y, amount), a];
  },
  tolerance: { abs: 1e-6, rel: 2 ** -10 },
});
