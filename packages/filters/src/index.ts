import type { Filter } from '@rullino/core';
import { adaptiveThreshold } from './adaptiveThreshold';
import { boxBlur } from './boxBlur';
import { brightness } from './brightness';
import { canny } from './canny';
import { contrast } from './contrast';
import { convolve } from './convolve';
import { exposure } from './exposure';
import { gamma } from './gamma';
import { gaussianBlur } from './gaussianBlur';
import { grayscale } from './grayscale';
import { invert } from './invert';
import { otsu } from './otsu';
import { posterize } from './posterize';
import { saturation } from './saturation';
import { sharpen } from './sharpen';
import { threshold } from './threshold';
import { unsharpMask } from './unsharpMask';
import { vibrance } from './vibrance';
import { whiteBalance } from './whiteBalance';

export {
  adaptiveThreshold,
  boxBlur,
  brightness,
  canny,
  contrast,
  convolve,
  exposure,
  gamma,
  gaussianBlur,
  grayscale,
  invert,
  otsu,
  posterize,
  saturation,
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
