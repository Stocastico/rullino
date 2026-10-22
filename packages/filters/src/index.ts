import type { Filter } from '@rullino/core';
import { adaptiveThreshold } from './adaptiveThreshold';
import { applyLut } from './applyLut';
import { bilateral } from './bilateral';
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
import { grain } from './grain';
import { grayscale } from './grayscale';
import { inpaint } from './inpaint';
import { invert } from './invert';
import { levels } from './levels';
import { median } from './median';
import { morphology } from './morphology';
import { otsu } from './otsu';
import { posterize } from './posterize';
import { saturation } from './saturation';
import { shadowsHighlights } from './shadowsHighlights';
import { sharpen } from './sharpen';
import { threshold } from './threshold';
import { transparency } from './transparency';
import { unsharpMask } from './unsharpMask';
import { vibrance } from './vibrance';
import { vignette } from './vignette';
import { whiteBalance } from './whiteBalance';

export {
  adaptiveThreshold,
  applyLut,
  bilateral,
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
  grain,
  grayscale,
  inpaint,
  invert,
  levels,
  median,
  morphology,
  otsu,
  posterize,
  saturation,
  shadowsHighlights,
  sharpen,
  threshold,
  transparency,
  unsharpMask,
  vibrance,
  vignette,
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
  transparency,
  grayscale,
  invert,
  threshold,
  otsu,
  adaptiveThreshold,
  posterize,
  applyLut,
  vignette,
  grain,
  gaussianBlur,
  boxBlur,
  sharpen,
  unsharpMask,
  convolve,
  canny,
  morphology,
  median,
  bilateral,
  inpaint,
];
