import { describe, expect, it } from 'vitest';
import { chroma, grey, lightness, px } from '../test-utils';
import { brightness } from './index';

describe('brightness', () => {
  it('is the identity at 0', () => {
    px(brightness, [0.3, 0.1, 0.05, 1]).forEach((v, i) => expect(v).toBeCloseTo([0.3, 0.1, 0.05, 1][i]!, 6));
  });

  it('lifts or lowers midtones while pinning black and white', () => {
    expect(lightness(px(brightness, grey(0.18), { amount: 0.5 }))).toBeGreaterThan(lightness(grey(0.18)));
    expect(lightness(px(brightness, grey(0.18), { amount: -0.5 }))).toBeLessThan(lightness(grey(0.18)));
    expect(px(brightness, grey(0), { amount: 1 })[0]).toBeCloseTo(0, 6);
    expect(px(brightness, grey(1), { amount: 1 })[0]).toBeCloseTo(1, 5);
  });

  it('keeps neutrals neutral', () => {
    expect(chroma(px(brightness, grey(0.3), { amount: 0.7 }))).toBeLessThan(1e-4);
  });
});
