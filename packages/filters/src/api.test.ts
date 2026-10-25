import { describe, expect, it } from 'vitest';
import * as api from './index';

// The public API of @rullino/filters: adding or removing an export is a deliberate change that shows up here.
describe('@rullino/filters public API', () => {
  it('exports exactly these runtime names', () => {
    expect(Object.keys(api).sort()).toEqual([
    'adaptiveThreshold', 'applyLut', 'ascii', 'autoAdjust', 'bilateral', 'blackPoint', 'bloom', 'boxBlur',
    'brightness', 'canny', 'channelMixer', 'chromaticAberration', 'clahe', 'colorGrading', 'colorMixer',
    'contrast', 'convolve', 'curves', 'dither', 'emboss', 'equalize', 'exposure', 'filters', 'gamma',
    'gaussianBlur', 'gradient', 'gradientMap', 'grain', 'grayscale', 'halftone', 'hue', 'inpaint', 'invert', 'kuwahara', 'laplacian', 'lensBlur',
    'levels', 'median', 'morphology', 'otsu', 'patch', 'pixelate', 'posterize', 'saturation',
    'shadowsHighlights', 'sharpen', 'sketch', 'threshold', 'transparency', 'unsharpMask', 'vibrance',
    'vignette', 'whiteBalance',
    ]);
  });
});
