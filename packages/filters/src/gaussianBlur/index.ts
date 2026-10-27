import { defineFilter } from '@rullino/core';
import { gaussianCpu, gaussianPass } from '../convolution';
import { gaussianFast } from '../fast';

/** Separable Gaussian blur (two passes), radius 3σ, on premultiplied linear light. */
export const gaussianBlur = defineFilter({
  id: 'gaussianBlur',
  label: 'Gaussian blur',
  description: 'Blurs with a bell-shaped weighting, the most natural-looking blur.',
  tryThis: 'Add a mask to blur only part of the picture, such as the background.',
  category: 'classic',
  kind: 'multipass',
  params: {
    sigma: { type: 'float', min: 0, max: 50, step: 0.1, default: 2, unit: 'px', label: 'Sigma (px)', description: 'The spread of the blur in pixels; 0 changes nothing.' },
  },
  passes: [gaussianPass('h', 'input', 'x'), gaussianPass('v', 'h', 'y')],
  cpu: (src, { sigma }) => gaussianCpu(src, sigma),
  fast: (src, { sigma }) => gaussianFast(src, sigma),
  // Two f16 roundings (intermediate + output) on sums of positive terms.
  tolerance: { abs: 1e-4, rel: 2 ** -9 },
});
