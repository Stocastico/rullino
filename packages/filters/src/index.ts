import type { Filter } from '@rullino/core';
export { autoAdjust, type AutoAdjustment } from './auto';
import { adaptiveThreshold } from './adaptiveThreshold';
import { ascii } from './ascii';
import { applyLut } from './applyLut';
import { bilateral } from './bilateral';
import { blackPoint } from './blackPoint';
import { bloom } from './bloom';
import { boxBlur } from './boxBlur';
import { brightness } from './brightness';
import { canny } from './canny';
import { channelMixer } from './channelMixer';
import { chromaticAberration } from './chromaticAberration';
import { clahe } from './clahe';
import { colorGrading } from './colorGrading';
import { colorMixer } from './colorMixer';
import { contrast } from './contrast';
import { convolve } from './convolve';
import { curves } from './curves';
import { dither } from './dither';
import { emboss } from './emboss';
import { gradient } from './gradient';
import { gradientMap } from './gradientMap';
import { laplacian } from './laplacian';
import { equalize } from './equalize';
import { exposure } from './exposure';
import { gamma } from './gamma';
import { gaussianBlur } from './gaussianBlur';
import { grain } from './grain';
import { grayscale } from './grayscale';
import { halftone } from './halftone';
import { hue } from './hue';
import { inpaint } from './inpaint';
import { patch } from './patch';
import { invert } from './invert';
import { kuwahara } from './kuwahara';
import { lensBlur } from './lensBlur';
import { levels } from './levels';
import { median } from './median';
import { morphology } from './morphology';
import { otsu } from './otsu';
import { pixelate } from './pixelate';
import { posterize } from './posterize';
import { saturation } from './saturation';
import { shadowsHighlights } from './shadowsHighlights';
import { sharpen } from './sharpen';
import { sketch } from './sketch';
import { threshold } from './threshold';
import { transparency } from './transparency';
import { unsharpMask } from './unsharpMask';
import { vibrance } from './vibrance';
import { vignette } from './vignette';
import { whiteBalance } from './whiteBalance';

export {
  adaptiveThreshold,
  ascii,
  applyLut,
  bilateral,
  blackPoint,
  bloom,
  boxBlur,
  brightness,
  canny,
  channelMixer,
  chromaticAberration,
  clahe,
  colorGrading,
  colorMixer,
  contrast,
  convolve,
  curves,
  dither,
  emboss,
  gradient,
  gradientMap,
  laplacian,
  equalize,
  exposure,
  gamma,
  gaussianBlur,
  grain,
  grayscale,
  halftone,
  hue,
  inpaint,
  patch,
  invert,
  kuwahara,
  lensBlur,
  levels,
  median,
  morphology,
  otsu,
  pixelate,
  posterize,
  saturation,
  shadowsHighlights,
  sharpen,
  sketch,
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
  ascii,
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
  patch,
  pixelate,
  halftone,
  dither,
  emboss,
  gradient,
  gradientMap,
  laplacian,
  sketch,
  bloom,
  chromaticAberration,
  kuwahara,
  lensBlur,
];
