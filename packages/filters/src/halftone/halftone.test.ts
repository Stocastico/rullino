import { linearToSrgb, srgbToLinear } from '@rullino/core';
import { describe, expect, it } from 'vitest';
import { imageOf } from '../test-utils';
import { halftone } from './index';

const flat = (v: number) => imageOf(96, 96, () => [srgbToLinear(v), srgbToLinear(v), srgbToLinear(v)]);
const meanEncoded = (img: { data: Float32Array }, c = 0) => {
  let s = 0;
  for (let i = c; i < img.data.length; i += 4) s += linearToSrgb(img.data[i]!);
  return s / (img.data.length / 4);
};

describe('halftone', () => {
  it('ink coverage follows the tone: the mean of the dots matches the grey level', () => {
    for (const v of [0.25, 0.5, 0.75]) expect(meanEncoded(halftone.cpu(flat(v), { size: 8 }))).toBeCloseTo(v, 1);
  });

  it('white stays white, black is (almost) all ink', () => {
    expect(meanEncoded(halftone.cpu(flat(1), { size: 8 }))).toBeCloseTo(1, 5);
    expect(meanEncoded(halftone.cpu(flat(0), { size: 8 }))).toBeLessThan(0.1);
  });

  it('mono output is neutral and only black / white away from dot edges', () => {
    const out = halftone.cpu(flat(0.5), { size: 12 });
    let mid = 0;
    for (let i = 0; i < out.data.length; i += 4) {
      expect(out.data[i]).toBe(out.data[i + 2]);
      const e = linearToSrgb(out.data[i]!);
      if (e > 0.05 && e < 0.95) mid++;
    }
    expect(mid / (out.data.length / 4)).toBeLessThan(0.3);
  });

  it('CMY mode prints each channel on its own screen: a red patch has no cyan... and full magenta and yellow', () => {
    const red = imageOf(96, 96, () => [1, 0, 0]);
    const out = halftone.cpu(red, { size: 8, mode: 'cmy' });
    expect(meanEncoded(out, 0)).toBeCloseTo(1, 5);
    expect(meanEncoded(out, 1)).toBeLessThan(0.1);
    expect(meanEncoded(out, 2)).toBeLessThan(0.1);
  });

  it('keeps alpha (premultiplied output)', () => {
    const img = imageOf(16, 16, () => [0.25, 0.25, 0.25]);
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = 0.5;
    const out = halftone.cpu(img, { size: 4 });
    for (let i = 0; i < out.data.length; i += 4) {
      expect(out.data[i + 3]).toBe(0.5);
      expect(out.data[i]).toBeLessThanOrEqual(0.5);
    }
  });
});
