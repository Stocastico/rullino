import type { Filter } from '@rullino/core';
import { adaptiveThreshold } from './adaptiveThreshold';
import { blackPoint } from './blackPoint';
import { boxBlur } from './boxBlur';
import { brightness } from './brightness';
import { canny } from './canny';
import { contrast } from './contrast';
import { convolve } from './convolve';
import { curves } from './curves';
import { exposure } from './exposure';
import { gamma } from './gamma';
import { gaussianBlur } from './gaussianBlur';
import { grayscale } from './grayscale';
import { invert } from './invert';
import { levels } from './levels';
import { otsu } from './otsu';
import { posterize } from './posterize';
import { saturation } from './saturation';
import { shadowsHighlights } from './shadowsHighlights';
import { sharpen } from './sharpen';
import { threshold } from './threshold';
import { unsharpMask } from './unsharpMask';
import { vibrance } from './vibrance';
import { whiteBalance } from './whiteBalance';

export {
  adaptiveThreshold,
  blackPoint,
  boxBlur,
  brightness,
  canny,
  contrast,
  convolve,
  curves,
  exposure,
  gamma,
  gaussianBlur,
  grayscale,
  invert,
  levels,
  otsu,
  posterize,
  saturation,
  shadowsHighlights,
  sharpen,
  threshold,
  unsharpMask,
  vibrance,
  whiteBalance,
};

/** Every filter, in the order the playground lists them. */
export const filters: readonly Filter<any>[] = [
  exposure,
  contrast,
  brightness,
  blackPoint,
  shadowsHighlights,
  curves,
  levels,
  gamma,
  saturation,
  vibrance,
  whiteBalance,
  grayscale,
  invert,
  threshold,
  otsu,
  adaptiveThreshold,
  posterize,
  gaussianBlur,
  boxBlur,
  sharpen,
  unsharpMask,
  convolve,
  canny,
];
