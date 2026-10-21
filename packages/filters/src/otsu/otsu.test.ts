import { srgbToLinear } from '@rullino/core';
import { describe, expect, it } from 'vitest';
import { at, imageOf } from '../test-utils';
import { otsu, otsuThreshold } from './index';

const enc = (v: number): [number, number, number] => {
  const l = srgbToLinear(v);
  return [l, l, l];
};

describe('otsuThreshold', () => {
  it('splits a two-level histogram at the first bin of the gap', () => {
    const h = new Array(256).fill(0);
    h[50] = 100;
    h[200] = 300;
    expect(otsuThreshold(h)).toBe(50);
  });

  it('finds the valley of a bimodal distribution', () => {
    const h = Array.from({ length: 256 }, (_, i) => Math.round(1000 * Math.exp(-((i - 60) ** 2) / 200) + 600 * Math.exp(-((i - 180) ** 2) / 300)));
    const t = otsuThreshold(h);
    expect(t).toBeGreaterThan(95);
    expect(t).toBeLessThan(145);
  });

  it('returns 0 for an empty or single-level histogram', () => {
    expect(otsuThreshold(new Array(256).fill(0))).toBe(0);
    const h = new Array(256).fill(0);
    h[128] = 10;
    expect(otsuThreshold(h)).toBe(0);
  });
});

describe('otsu', () => {
  const img = imageOf(20, 10, (x, y) => enc((x + y) % 3 === 0 ? 0.25 : 0.75));

  it('separates two grey levels into black and white', () => {
    const out = otsu.cpu(img);
    for (let y = 0; y < 10; y++)
      for (let x = 0; x < 20; x++) expect(at(out, x, y)).toBe((x + y) % 3 === 0 ? 0 : 1);
  });

  it('can invert', () => {
    expect(at(otsu.cpu(img, { invert: true }), 0, 0)).toBe(1);
  });

  it('ignores fully transparent pixels when choosing the threshold', () => {
    // Left half transparent black; the right half alone decides the split.
    const t = imageOf(20, 10, (x, y) => (x < 10 ? [0, 0, 0] : enc(y < 5 ? 0.6 : 0.9)));
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) t.data[(y * 20 + x) * 4 + 3] = 0;
    const out = otsu.cpu(t);
    expect(at(out, 15, 2)).toBe(0);
    expect(at(out, 15, 7)).toBe(1);
    expect(at(out, 2, 2, 3)).toBe(0); // alpha kept
  });
});
