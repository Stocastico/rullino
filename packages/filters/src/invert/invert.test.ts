import { linearToSrgb, srgbToLinear } from '@rullino/core';
import { describe, expect, it } from 'vitest';
import { grey, px } from '../test-utils';
import { invert } from './index';

describe('invert', () => {
  it('swaps black and white and keeps alpha', () => {
    expect(px(invert, grey(0))[0]).toBeCloseTo(1, 6);
    expect(px(invert, grey(1))[0]).toBeCloseTo(0, 6);
    expect(px(invert, grey(1, 0.5))[3]).toBe(0.5);
  });

  it('inverts in perceptual (sRGB-encoded) space, so mid grey stays mid grey', () => {
    const mid = srgbToLinear(0.5);
    expect(px(invert, grey(mid))[0]).toBeCloseTo(mid, 5);
    expect(linearToSrgb(px(invert, grey(srgbToLinear(0.2)))[0])).toBeCloseTo(0.8, 5);
  });

  it('is an involution on in-range colours', () => {
    const c = [0.3, 0.1, 0.7, 1] as [number, number, number, number];
    px(invert, px(invert, c)).forEach((v, i) => expect(v).toBeCloseTo(c[i]!, 5));
  });

  it('clamps HDR values to white before inverting', () => {
    expect(px(invert, grey(3))[0]).toBeCloseTo(0, 6);
  });
});
