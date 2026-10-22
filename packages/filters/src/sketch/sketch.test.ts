import { linearToSrgb, srgbToLinear } from '@rullino/core';
import { describe, expect, it } from 'vitest';
import { at, imageOf } from '../test-utils';
import { sketch } from './index';

const enc = (img: { width: number; data: Float32Array }, x: number, y: number) => linearToSrgb(at(img, x, y));

describe('sketch', () => {
  it('flat areas become white paper, whatever their tone', () => {
    for (const v of [0.2, 0.7]) {
      const flat = imageOf(15, 15, () => [srgbToLinear(v), srgbToLinear(v), srgbToLinear(v)]);
      expect(enc(sketch.cpu(flat, {}), 7, 7)).toBeCloseTo(1, 2);
    }
  });

  it('draws dark lines on the dark side of edges; output is grey', () => {
    const img = imageOf(21, 9, (x) => (x >= 10 ? [1, 1, 1] : [srgbToLinear(0.3), srgbToLinear(0.2), srgbToLinear(0.25)]));
    const out = sketch.cpu(img, { sigma: 2 });
    expect(enc(out, 9, 4)).toBeLessThan(0.6);
    expect(enc(out, 2, 4)).toBeGreaterThan(0.95);
    expect(enc(out, 18, 4)).toBeGreaterThan(0.95);
    expect(at(out, 9, 4, 0)).toBe(at(out, 9, 4, 2));
  });

  it('darkness deepens the lines; sigma is in px', () => {
    const img = imageOf(21, 9, (x) => (x >= 10 ? [1, 1, 1] : [0.05, 0.05, 0.05]));
    expect(enc(sketch.cpu(img, { darkness: 3 }), 9, 4)).toBeLessThan(enc(sketch.cpu(img, { darkness: 1 }), 9, 4));
    expect(sketch.params.sigma.unit).toBe('px');
  });
});
