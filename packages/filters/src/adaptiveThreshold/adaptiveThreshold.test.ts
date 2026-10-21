import { srgbToLinear } from '@rullino/core';
import { describe, expect, it } from 'vitest';
import { at, imageOf } from '../test-utils';
import { adaptiveThreshold } from './index';

const enc = (v: number): [number, number, number] => {
  const l = srgbToLinear(v);
  return [l, l, l];
};

// Dark dots on a background going from dark to bright: no single global threshold works.
const isDot = (x: number, y: number) => x % 8 === 4 && y % 8 === 4;
const img = imageOf(64, 24, (x, y) => {
  const bg = 0.15 + 0.7 * (x / 63);
  return enc(isDot(x, y) ? bg - 0.12 : bg);
});

describe('adaptiveThreshold', () => {
  it('finds local features under uneven illumination', () => {
    const out = adaptiveThreshold.cpu(img, { sigma: 4, offset: 0.02 });
    for (const x of [4, 28, 60]) expect(at(out, x, 12)).toBe(0); // dots, dark and bright side
    for (const x of [1, 30, 62]) expect(at(out, x, 10)).toBe(1); // background
  });

  it('marks everything white on a flat image with a positive offset', () => {
    const out = adaptiveThreshold.cpu(imageOf(10, 10, () => enc(0.4)), { offset: 0.02 });
    expect(Array.from(out.data).every((v) => v === 1)).toBe(true);
  });

  it('can invert and measures sigma in pixels', () => {
    expect(at(adaptiveThreshold.cpu(img, { sigma: 4, invert: true }), 4, 12)).toBe(1);
    expect(adaptiveThreshold.params.sigma.unit).toBe('px');
  });
});
