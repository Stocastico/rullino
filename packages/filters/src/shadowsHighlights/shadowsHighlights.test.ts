import { describe, expect, it } from 'vitest';
import { grey, lightness, px } from '../test-utils';
import { shadowsHighlights } from './index';

const L = (v: number, p: Parameters<typeof shadowsHighlights.cpu>[1]) => lightness(px(shadowsHighlights, grey(v), p));

describe('shadowsHighlights', () => {
  it('is the identity at 0 / 0', () => {
    px(shadowsHighlights, [0.3, 0.1, 0.05, 1]).forEach((v, i) => expect(v).toBeCloseTo([0.3, 0.1, 0.05, 1][i]!, 6));
  });

  it('lifts shadows more than highlights, keeping black and white', () => {
    expect(L(0.02, { shadows: 1 }) - lightness(grey(0.02))).toBeGreaterThan(L(0.6, { shadows: 1 }) - lightness(grey(0.6)));
    expect(L(0, { shadows: 1 })).toBeCloseTo(0, 6);
    expect(L(1, { shadows: 1 })).toBeCloseTo(1, 5);
  });

  it('recovers highlights with a negative amount, keeping black and white', () => {
    expect(L(0.5, { highlights: -1 })).toBeLessThan(lightness(grey(0.5)));
    expect(L(0, { highlights: -1 })).toBeCloseTo(0, 6);
    expect(L(1, { highlights: -1 })).toBeCloseTo(1, 5);
  });

  it('stays monotone at the extremes', () => {
    for (const p of [{ shadows: 1 }, { shadows: -1 }, { highlights: 1 }, { highlights: -1 }, { shadows: 1, highlights: -1 }]) {
      let prev = -1;
      for (let v = 0; v <= 1.0001; v += 0.01) {
        const l = L(v, p);
        expect(l).toBeGreaterThanOrEqual(prev - 1e-6);
        prev = l;
      }
    }
  });

  it('leaves HDR values above white untouched', () => {
    expect(px(shadowsHighlights, grey(3), { shadows: 1, highlights: 1 })[0]).toBeCloseTo(3, 4);
  });
});
