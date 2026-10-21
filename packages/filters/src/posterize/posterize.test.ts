import { linearToSrgb, srgbToLinear } from '@rullino/core';
import { describe, expect, it } from 'vitest';
import { px } from '../test-utils';
import { posterize } from './index';

describe('posterize', () => {
  it('quantises each channel to evenly spaced perceptual levels', () => {
    const out = px(posterize, [0.03, 0.2, 0.7, 1], { levels: 3 }).slice(0, 3).map(linearToSrgb);
    // Allowed encoded values for 3 levels: 0, 0.5, 1.
    for (const v of out) expect([0, 0.5, 1].some((l) => Math.abs(v - l) < 1e-6)).toBe(true);
  });

  it('rounds to the nearest level', () => {
    const [r, g] = px(posterize, [srgbToLinear(0.2), srgbToLinear(0.3), 0, 1], { levels: 2 });
    expect(r).toBe(0);
    expect(g).toBe(0); // 0.3 is closer to 0 than to 1
    expect(px(posterize, [srgbToLinear(0.6), 0, 0, 1], { levels: 2 })[0]).toBeCloseTo(1, 6);
  });

  it('rounds fractional level counts', () => {
    expect(px(posterize, [srgbToLinear(0.3), 0, 0, 1], { levels: 2.4 })).toEqual(px(posterize, [srgbToLinear(0.3), 0, 0, 1], { levels: 2 }));
  });
});
