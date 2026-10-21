import { luminance } from '@rullino/core';
import { describe, expect, it } from 'vitest';
import { grey, px } from '../test-utils';
import { whiteBalance } from './index';

describe('whiteBalance', () => {
  it('is the identity at 0 / 0', () => {
    expect(px(whiteBalance, [0.25, 0.5, 0.125, 1])).toEqual([0.25, 0.5, 0.125, 1]);
  });

  it('warms with positive temperature and cools with negative', () => {
    const [r, , b] = px(whiteBalance, grey(0.4), { temperature: 0.5 });
    expect(r).toBeGreaterThan(b);
    const [r2, , b2] = px(whiteBalance, grey(0.4), { temperature: -0.5 });
    expect(r2).toBeLessThan(b2);
  });

  it('shifts towards magenta with positive tint', () => {
    const [r, g, b] = px(whiteBalance, grey(0.4), { tint: 0.5 });
    expect(g).toBeLessThan(r);
    expect(g).toBeLessThan(b);
  });

  it('preserves the luminance of neutrals', () => {
    for (const p of [{ temperature: 1 }, { tint: -1 }, { temperature: -0.7, tint: 0.4 }]) {
      const [r, g, b] = px(whiteBalance, grey(0.4), p);
      expect(luminance(r, g, b)).toBeCloseTo(0.4, 5);
    }
  });
});
