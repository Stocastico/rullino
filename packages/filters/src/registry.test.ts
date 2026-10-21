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
      ['boxBlur', 'brightness', 'contrast', 'convolve', 'exposure', 'gamma', 'gaussianBlur', 'grayscale', 'invert', 'posterize', 'saturation', 'sharpen', 'threshold', 'unsharpMask', 'vibrance', 'whiteBalance'].sort(),
    );
  });

  it.each(filters.map((f) => [f.id, f] as const))('%s: defaults are valid and every param has a label', (_, f) => {
    expect(() => f.cpu({ width: 1, height: 1, data: new Float32Array([0.2, 0.3, 0.4, 1]) }, defaultParams(f.params))).not.toThrow();
    for (const p of Object.values(f.params as ParamSchema)) expect(p.label, `${f.id} param label`).toBeTruthy();
  });
});
