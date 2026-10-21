import { srgbToLinear } from '@rullino/core';
import { describe, expect, it } from 'vitest';
import { grey, px } from '../test-utils';
import { threshold } from './index';

describe('threshold', () => {
  it('compares perceptual (sRGB-encoded) luminance with the level', () => {
    // 18% linear grey encodes to ~0.46.
    expect(px(threshold, grey(0.18), { level: 0.5 })).toEqual([0, 0, 0, 1]);
    expect(px(threshold, grey(0.18), { level: 0.4 })).toEqual([1, 1, 1, 1]);
    expect(px(threshold, grey(srgbToLinear(0.5)), { level: 0.5 })).toEqual([1, 1, 1, 1]); // >= level is white
  });

  it('can invert', () => {
    expect(px(threshold, grey(0.18), { level: 0.4, invert: true })).toEqual([0, 0, 0, 1]);
  });

  it('keeps alpha, output premultiplied', () => {
    expect(px(threshold, grey(0.9, 0.5), { level: 0.5 })).toEqual([0.5, 0.5, 0.5, 0.5]);
  });
});
