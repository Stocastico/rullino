import type { Filter } from '@rullino/core';
export { autoAdjust, type AutoAdjustment } from './auto';
import { adaptiveThreshold } from './adaptiveThreshold';
import { applyLut } from './applyLut';
import { bilateral } from './bilateral';
import { blackPoint } from './blackPoint';
import { boxBlur } from './boxBlur';
import { brightness } from './brightness';
import { canny } from './canny';
import { channelMixer } from './channelMixer';
import { clahe } from './clahe';
import { colorGrading } from './colorGrading';
import { colorMixer } from './colorMixer';
import { contrast } from './contrast';
import { convolve } from './convolve';
import { curves } from './curves';
import { equalize } from './equalize';
import { exposure } from './exposure';
import { gamma } from './gamma';
import { gaussianBlur } from './gaussianBlur';
import { grain } from './grain';
import { grayscale } from './grayscale';
import { halftone } from './halftone';
import { hue } from './hue';
import { inpaint } from './inpaint';
import { invert } from './invert';
import { levels } from './levels';
import { median } from './median';
import { morphology } from './morphology';
import { otsu } from './otsu';
import { pixelate } from './pixelate';
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
  channelMixer,
  clahe,
  colorGrading,
  colorMixer,
  contrast,
  convolve,
  curves,
  equalize,
  exposure,
  gamma,
  gaussianBlur,
  grain,
  grayscale,
  halftone,
  hue,
  inpaint,
  invert,
  levels,
  median,
  morphology,
  otsu,
  pixelate,
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
  equalize,
  clahe,
  gamma,
  saturation,
  vibrance,
  hue,
  colorMixer,
  colorGrading,
  channelMixer,
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
  pixelate,
  halftone,
];
