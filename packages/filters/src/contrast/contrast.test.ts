import { describe, expect, it } from 'vitest';
import { chroma, grey, lightness, px } from '../test-utils';
import { contrast } from './index';

describe('contrast', () => {
  it('is the identity at 0', () => {
    px(contrast, [0.3, 0.1, 0.05, 1]).forEach((v, i) => expect(v).toBeCloseTo([0.3, 0.1, 0.05, 1][i]!, 6));
  });

  it('pivots on 18% grey and spreads lightness around it', () => {
    expect(px(contrast, grey(0.18), { amount: 1 })[0]).toBeCloseTo(0.18, 5);
    expect(lightness(px(contrast, grey(0.05), { amount: 0.5 }))).toBeLessThan(lightness(grey(0.05)));
    expect(lightness(px(contrast, grey(0.6), { amount: 0.5 }))).toBeGreaterThan(lightness(grey(0.6)));
    expect(lightness(px(contrast, grey(0.6), { amount: -0.5 }))).toBeLessThan(lightness(grey(0.6)));
  });

  it('keeps neutrals neutral and does not go below black', () => {
    expect(chroma(px(contrast, grey(0.4), { amount: 1 }))).toBeLessThan(1e-4);
    // Floored lightness gives exactly black up to float noise from the OKLab round trip.
    expect(px(contrast, grey(0.001), { amount: 1 })[0]).toBeGreaterThan(-1e-12);
  });

  it('works on straight colour under partial alpha', () => {
    const [r, , , a] = px(contrast, grey(0.18, 0.5), { amount: 1 });
    expect(a).toBe(0.5);
    expect(r / a).toBeCloseTo(0.18, 5);
  });
});
