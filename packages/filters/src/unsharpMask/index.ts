import { createImage, defineFilter, type LinearImage } from '@rullino/core';
import { gaussianCpu, gaussianPass, gaussianReach } from '../convolution';
import { gaussianFast } from '../fast';

/**
 * Unsharp mask: c' = c + amount · (c − gaussian(c, σ)) on colour; alpha kept, colour floored at 0.
 * No threshold yet: a hard threshold makes GPU/CPU parity unstable at the boundary.
 */
export const unsharpMask = defineFilter({
  id: 'unsharpMask',
  label: 'Unsharp mask',
  description: 'Sharpens by subtracting a blurred copy, the classic photographic method; the radius sets which detail is boosted.',
  tryThis: 'Use a small radius for fine detail and a large one for a broad local-contrast boost.',
  category: 'classic',
  kind: 'multipass',
  params: {
    amount: { type: 'float', min: 0, max: 5, step: 0.01, default: 1, label: 'Amount', description: 'How strongly the detail is boosted; 0 changes nothing.' },
    sigma: { type: 'float', min: 0.3, max: 50, step: 0.1, default: 2, unit: 'px', label: 'Radius σ (px)', description: 'Size of the blur that is subtracted, in pixels. Small boosts fine texture, large boosts broader contrast.' },
  },
  passes: [
    gaussianPass('h', 'input', 'x'),
    gaussianPass('v', 'h', 'y'),
    {
      name: 'out',
      inputs: ['input', 'v'],
      wgsl: /* wgsl */ `
fn run(xy: vec2i, p: Params) -> vec4f {
  let c = load_input(xy);
  return vec4f(max(c.rgb + p.amount * (c.rgb - load_v(xy).rgb), vec3f(0.0)), c.a);
}`,
    },
  ],
  reach: ({ sigma }) => gaussianReach(sigma),
  cpu: (src, { amount, sigma }) => sharpenFrom(src, gaussianCpu(src, sigma), amount),
  fast: (src, { amount, sigma }) => sharpenFrom(src, gaussianFast(src, sigma), amount),
  // The blurred intermediate is rounded to f16 and then amplified by `amount` (up to 5).
  tolerance: { abs: 5e-3, rel: 5e-3 },
});

function sharpenFrom(src: LinearImage, blur: LinearImage, amount: number): LinearImage {
  const out = createImage(src.width, src.height);
  for (let i = 0; i < src.data.length; i += 4) {
    for (let c = 0; c < 3; c++) out.data[i + c] = Math.max(0, src.data[i + c]! + amount * (src.data[i + c]! - blur.data[i + c]!));
    out.data[i + 3] = src.data[i + 3]!;
  }
  return out;
}
