import { createImage, defineFilter } from '@rullino/core';
import { clampLoad } from '../convolution';

/**
 * 3×3 Laplacian sharpen on colour: c' = c + amount · (4c − N − S − E − W). Alpha is kept and
 * colour is floored at 0 (overshoot below black is not light). Values above 1 are allowed.
 */
export const sharpen = defineFilter({
  id: 'sharpen',
  label: 'Sharpen',
  description: 'Makes edges crisper by emphasising the difference between each pixel and its four neighbours.',
  tryThis: 'Zoom to 100% and raise it until edges stand out, then back off before halos appear.',
  category: 'classic',
  kind: 'multipass',
  params: {
    amount: { type: 'float', min: 0, max: 3, step: 0.01, default: 0.5, label: 'Amount', description: 'Strength of the sharpening; 0 changes nothing.' },
  },
  passes: [
    {
      name: 'out',
      inputs: ['input'],
      wgsl: /* wgsl */ `
fn run(xy: vec2i, p: Params) -> vec4f {
  let c = load_input(xy);
  let n = load_input(xy + vec2i(0, -1)).rgb + load_input(xy + vec2i(0, 1)).rgb
        + load_input(xy + vec2i(-1, 0)).rgb + load_input(xy + vec2i(1, 0)).rgb;
  return vec4f(max(c.rgb + p.amount * (4.0 * c.rgb - n), vec3f(0.0)), c.a);
}`,
    },
  ],
  cpu: (src, { amount }) => {
    const out = createImage(src.width, src.height);
    for (let y = 0; y < src.height; y++)
      for (let x = 0; x < src.width; x++) {
        const o = (y * src.width + x) * 4;
        for (let c = 0; c < 3; c++) {
          const v = src.data[o + c]!;
          const n = clampLoad(src, x, y - 1, c) + clampLoad(src, x, y + 1, c) + clampLoad(src, x - 1, y, c) + clampLoad(src, x + 1, y, c);
          out.data[o + c] = Math.max(0, v + amount * (4 * v - n));
        }
        out.data[o + 3] = src.data[o + 3]!;
      }
    return out;
  },
  // Up to 13x amplification of input rounding at amount 3.
  tolerance: { abs: 1e-3, rel: 2e-3 },
});
