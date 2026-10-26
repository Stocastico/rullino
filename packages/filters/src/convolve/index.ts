import { createImage, defineFilter } from '@rullino/core';
import { clampLoad } from '../convolution';

const IDENTITY = Array.from({ length: 25 }, (_, i) => (i === 12 ? 1 : 0));

/**
 * Custom 5×5 convolution on colour (a 3×3 kernel is the centre of the grid). Optional
 * normalisation by the kernel sum, plus a bias in linear units (scaled by alpha). Alpha is kept
 * and colour is floored at 0.
 */
export const convolve = defineFilter({
  id: 'convolve',
  label: 'Custom kernel',
  description: 'Applies your own 5×5 kernel: each output pixel is a weighted sum of its neighbours. A 3×3 kernel goes in the centre.',
  tryThis: 'Put 1 in the centre and 0 elsewhere for no change, then try 5 in the centre with -1 on the four cells next to it for a sharpen.',
  preview: { kernel: [0, 0, 0, 0, 0, 0, 0, -1, 0, 0, 0, -1, 5, -1, 0, 0, 0, -1, 0, 0, 0, 0, 0, 0, 0] },
  category: 'classic',
  kind: 'multipass',
  params: {
    kernel: { type: 'kernel', size: 5, default: IDENTITY, label: 'Kernel', description: 'The weights. The centre cell is the pixel itself.' },
    normalize: { type: 'bool', default: true, label: 'Normalise by sum', description: 'Divide by the sum of the weights, so a blur keeps the overall brightness.' },
    bias: { type: 'float', min: -1, max: 1, step: 0.01, default: 0, label: 'Bias', description: 'Added to the result, useful for kernels whose weights add up to zero (edge detectors).' },
  },
  passes: [
    {
      name: 'out',
      inputs: ['input'],
      // Reads the kernel from the global `params`: WGSL only allows dynamic indexing of
      // arrays through a memory view, not of the by-value copy `p`.
      wgsl: /* wgsl */ `
fn run(xy: vec2i, p: Params) -> vec4f {
  var acc = vec3f(0.0);
  var total = 0.0;
  for (var j = 0; j < 5; j++) {
    for (var i = 0; i < 5; i++) {
      let n = j * 5 + i;
      let w = params.kernel[n / 4][n % 4];
      acc += w * load_input(xy + vec2i(i - 2, j - 2)).rgb;
      total += w;
    }
  }
  if (p.normalize == 1u && abs(total) > 1e-6) { acc /= total; }
  let c = load_input(xy);
  return vec4f(max(acc + p.bias * c.a, vec3f(0.0)), c.a);
}`,
    },
  ],
  cpu: (src, { kernel, normalize, bias }) => {
    const total = kernel.reduce((a, b) => a + b, 0);
    const norm = normalize && Math.abs(total) > 1e-6 ? total : 1;
    const out = createImage(src.width, src.height);
    for (let y = 0; y < src.height; y++)
      for (let x = 0; x < src.width; x++) {
        const o = (y * src.width + x) * 4;
        const a = src.data[o + 3]!;
        for (let c = 0; c < 3; c++) {
          let acc = 0;
          for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) acc += kernel[j * 5 + i]! * clampLoad(src, x + i - 2, y + j - 2, c);
          out.data[o + c] = Math.max(0, acc / norm + bias * a);
        }
        out.data[o + 3] = a;
      }
    return out;
  },
  tolerance: { abs: 2e-3, rel: 2e-3 },
});
