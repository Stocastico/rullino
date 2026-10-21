import { describe, expect, it } from 'vitest';
import { chroma, grey, lightness, px } from '../test-utils';
import { blackPoint } from './index';

describe('blackPoint', () => {
  it('is the identity at 0', () => {
    px(blackPoint, [0.3, 0.1, 0.05, 1]).forEach((v, i) => expect(v).toBeCloseTo([0.3, 0.1, 0.05, 1][i]!, 6));
  });

  it('crushes shadows to black with a positive amount, white stays', () => {
    expect(lightness(px(blackPoint, grey(0.002), { amount: 0.15 }))).toBeCloseTo(0, 6);
    expect(lightness(px(blackPoint, grey(0.1), { amount: 0.15 }))).toBeLessThan(lightness(grey(0.1)));
    expect(px(blackPoint, grey(1), { amount: 0.15 })[0]).toBeCloseTo(1, 5);
  });

  it('lifts black with a negative amount, white stays', () => {
    expect(lightness(px(blackPoint, grey(0), { amount: -0.1 }))).toBeCloseTo(0.1 / 1.1, 5);
    expect(px(blackPoint, grey(1), { amount: -0.1 })[0]).toBeCloseTo(1, 5);
  });

  it('keeps neutrals neutral', () => {
    expect(chroma(px(blackPoint, grey(0.3), { amount: 0.1 }))).toBeLessThan(1e-4);
  });
});
