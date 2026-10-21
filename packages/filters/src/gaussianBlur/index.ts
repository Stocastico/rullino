import { defineFilter } from '@rullino/core';
import { gaussianCpu, gaussianPass } from '../convolution';

/** Separable Gaussian blur (two passes), radius 3σ, on premultiplied linear light. */
export const gaussianBlur = defineFilter({
  id: 'gaussianBlur',
  label: 'Gaussian blur',
  category: 'classic',
  kind: 'multipass',
  params: {
    sigma: { type: 'float', min: 0, max: 50, step: 0.1, default: 2, unit: 'px', label: 'Sigma (px)' },
  },
  passes: [gaussianPass('h', 'input', 'x'), gaussianPass('v', 'h', 'y')],
  cpu: (src, { sigma }) => gaussianCpu(src, sigma),
  // Two f16 roundings (intermediate + output) on sums of positive terms.
  tolerance: { abs: 1e-4, rel: 2 ** -9 },
});
