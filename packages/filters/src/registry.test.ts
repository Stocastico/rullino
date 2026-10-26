import { defaultParams, type ParamSchema } from '@rullino/core';
import { describe, expect, it } from 'vitest';
import { filters } from './index';

describe('filter registry', () => {
  it('has unique ids', () => {
    const ids = filters.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('contains the expected filters', () => {
    expect(filters.map((f) => f.id).sort()).toEqual(
      ['adaptiveThreshold', 'applyLut', 'ascii', 'bilateral', 'blackPoint', 'bloom', 'boxBlur', 'brightness', 'canny', 'channelMixer', 'chromaticAberration', 'clahe', 'colorGrading', 'colorMixer', 'contrast', 'convolve', 'curves', 'dither', 'emboss', 'equalize', 'exposure', 'gamma', 'gaussianBlur', 'gradient', 'gradientMap', 'grain', 'grayscale', 'halftone', 'hue', 'inpaint', 'invert', 'kuwahara', 'laplacian', 'lensBlur', 'levels', 'median', 'morphology', 'otsu', 'patch', 'pixelate', 'posterize', 'saturation', 'shadowsHighlights', 'sharpen', 'sketch', 'threshold', 'transparency', 'unsharpMask', 'vibrance', 'vignette', 'whiteBalance'].sort(),
    );
  });

  it.each(filters.map((f) => [f.id, f] as const))('%s: defaults are valid and every param has a label', (_, f) => {
    const mask = f.kind === 'multipass' && f.usesMask ? new Float32Array([1]) : undefined;
    expect(() => f.cpu({ width: 1, height: 1, data: new Float32Array([0.2, 0.3, 0.4, 1]) }, defaultParams(f.params), mask)).not.toThrow();
    for (const p of Object.values(f.params as ParamSchema)) expect(p.label, `${f.id} param label`).toBeTruthy();
  });

  // The playground explains filters from their schemas. Categories are added here as their texts are
  // written; once every category is listed, this becomes a rule for all filters.
  const DESCRIBED = ['adjust', 'classic'];
  it.each(filters.filter((f) => DESCRIBED.includes(f.category)).map((f) => [f.id, f] as const))(
    '%s: has a description, a try-this and a description on every param',
    (_, f) => {
      expect(f.description, `${f.id} description`).toBeTruthy();
      expect(f.tryThis, `${f.id} tryThis`).toBeTruthy();
      for (const [key, p] of Object.entries(f.params as ParamSchema)) expect(p.description, `${f.id}.${key} description`).toBeTruthy();
    },
  );
});
