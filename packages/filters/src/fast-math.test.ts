import { linearToSrgb, srgbToLinear } from '@rullino/core';
import { describe, expect, it } from 'vitest';
import { toLinear, toSrgb } from './fast';

describe('table-based sRGB transfer functions', () => {
  // Dense enough to land between table entries everywhere, plus the kinks and the ends.
  const xs = [...Array.from({ length: 100_001 }, (_, i) => i / 100_000), 0.0031308, 0.04045, 1e-6, 1e-9];

  it('match the exact ones within 1e-6 on [0, 1]', () => {
    let worstSrgb = 0;
    let worstLinear = 0;
    for (const x of xs) {
      worstSrgb = Math.max(worstSrgb, Math.abs(toSrgb(x) - linearToSrgb(x)));
      worstLinear = Math.max(worstLinear, Math.abs(toLinear(x) - srgbToLinear(x)));
    }
    expect(worstSrgb).toBeLessThan(1e-6);
    expect(worstLinear).toBeLessThan(1e-6);
  });

  it('are exact on the linear segments near 0, where a relative error would be amplified (levels gamma)', () => {
    for (const x of [1e-12, 3e-9, 1e-5, 0.003, 0.0031308]) expect(toSrgb(x)).toBe(linearToSrgb(x));
    for (const x of [1e-12, 3e-9, 1e-5, 0.04, 0.04045]) expect(toLinear(x)).toBe(srgbToLinear(x));
  });

  it('are exact outside [0, 1] (HDR, negatives) and at 0 and 1', () => {
    for (const x of [-2, -0.5, -1e-3, 1.0001, 1.5, 7, 0, 1]) {
      expect(toSrgb(x)).toBe(linearToSrgb(x));
      expect(toLinear(x)).toBe(srgbToLinear(x));
    }
  });
});
