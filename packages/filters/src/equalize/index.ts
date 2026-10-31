import { defineFilter } from '@rullino/core';
import { equalizeBuffers, equalizeCpu, equalizePasses } from '../equalization';
import { OKLAB_TOLERANCE } from '../shared';

/**
 * Global histogram equalisation of OKLab lightness (hue and chroma kept): lightness is remapped
 * through its own cumulative distribution, spreading the tones over the whole range. Transparent
 * pixels are ignored. `amount` blends with the original lightness.
 */
export const equalize = defineFilter({
  id: 'equalize',
  label: 'Equalise histogram',
  description: 'Spreads the tones evenly across the brightness range, which stretches contrast on flat images.',
  tryThis: 'Try it on a dull, hazy photo, then lower Amount until it stops looking harsh.',
  category: 'adjust',
  kind: 'multipass',
  params: {
    amount: { type: 'float', min: 0, max: 1, step: 0.01, default: 1, label: 'Amount', description: 'Blend between the original (0) and the fully equalised picture (1).' },
  },
  buffers: equalizeBuffers(1),
  passes: equalizePasses('1', '1e9'),
  reach: 'global', // needs the histogram of the whole image
  cpu: (src, { amount }) => equalizeCpu(src, 1, 1e9, amount),
  tolerance: OKLAB_TOLERANCE,
});
