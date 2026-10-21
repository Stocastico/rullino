import type { PointwiseFilter } from '@rullino/core';
import { brightness } from './brightness';
import { contrast } from './contrast';
import { exposure } from './exposure';
import { gamma } from './gamma';
import { grayscale } from './grayscale';
import { invert } from './invert';
import { posterize } from './posterize';
import { saturation } from './saturation';
import { threshold } from './threshold';
import { vibrance } from './vibrance';
import { whiteBalance } from './whiteBalance';

export { brightness, contrast, exposure, gamma, grayscale, invert, posterize, saturation, threshold, vibrance, whiteBalance };

/** Every filter, in the order the playground lists them. */
export const filters: readonly PointwiseFilter<any>[] = [
  exposure,
  contrast,
  brightness,
  gamma,
  saturation,
  vibrance,
  whiteBalance,
  grayscale,
  invert,
  threshold,
  posterize,
];
