import { linearToSrgb, srgbToLinear } from '@rullino/core';
import { describe, expect, it } from 'vitest';
import { imageOf } from '../test-utils';
import { bayer, dither } from './index';

const flat = (v: number, w = 16, h = 16) => imageOf(w, h, () => [srgbToLinear(v), srgbToLinear(v), srgbToLinear(v)]);
const encodedValues = (img: { data: Float32Array }, c = 0) => {
  const out: number[] = [];
  for (let i = c; i < img.data.length; i += 4) out.push(Math.round(linearToSrgb(img.data[i]!) * 1e6) / 1e6);
  return out;
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('dither', () => {
  it('builds the classic Bayer matrices', () => {
    expect([0, 1].flatMap((y) => [0, 1].map((x) => bayer(x, y, 2)))).toEqual([0, 2, 3, 1]);
    expect([0, 1, 2, 3].flatMap((y) => [0, 1, 2, 3].map((x) => bayer(x, y, 4)))).toEqual([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]);
    expect(new Set([...Array(64)].map((_, i) => bayer(i % 8, i >> 3, 8))).size).toBe(64);
  });

  it('outputs only the quantised levels, keeping the mean tone', () => {
    for (const v of [0.2, 0.5, 0.83]) {
      const out = encodedValues(dither.cpu(flat(v), { levels: 2 }));
      expect(new Set(out)).toEqual(new Set([0, 1]));
      expect(mean(out)).toBeCloseTo(v, 1);
    }
    const four = encodedValues(dither.cpu(flat(0.4), { levels: 4 }));
    expect([...new Set(four)].every((x) => [0, 1 / 3, 2 / 3, 1].some((l) => Math.abs(l - x) < 1e-5))).toBe(true);
    expect(mean(four)).toBeCloseTo(0.4, 1);
  });

  it('black and white stay put; mid grey is half on with 2 levels', () => {
    expect(encodedValues(dither.cpu(flat(0), { levels: 2 })).every((x) => x === 0)).toBe(true);
    expect(encodedValues(dither.cpu(flat(1), { levels: 2 })).every((x) => x === 1)).toBe(true);
    expect(mean(encodedValues(dither.cpu(flat(0.5), { levels: 2 })))).toBe(0.5);
  });

  it('colour mode dithers each channel; mono outputs greys', () => {
    const img = imageOf(8, 8, () => [srgbToLinear(1), srgbToLinear(0.5), 0]);
    const colour = dither.cpu(img, { mode: 'color' });
    expect(new Set(encodedValues(colour, 0))).toEqual(new Set([1]));
    expect(mean(encodedValues(colour, 1))).toBe(0.5);
    expect(new Set(encodedValues(colour, 2))).toEqual(new Set([0]));
    const mono = dither.cpu(img, { mode: 'mono' });
    expect(encodedValues(mono, 0)).toEqual(encodedValues(mono, 2));
  });

  it('cell size scales the pattern (px)', () => {
    const one = encodedValues(dither.cpu(flat(0.5), { scale: 1 }));
    const two = encodedValues(dither.cpu(flat(0.5), { scale: 2 }));
    expect(two[0]).toBe(two[1]);
    expect(two[0]).toBe(one[0]);
    expect(dither.params.scale.unit).toBe('px');
  });
});
