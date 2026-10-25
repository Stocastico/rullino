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

  describe('shapes and grids', () => {
    const enc = (img: { width: number; data: Float32Array }, x: number, y: number) => linearToSrgb(img.data[(y * img.width + x) * 4]!);
    const grey = flat(0.5);

    it('square dots keep the tone like round ones (dot area = coverage)', () => {
      for (const v of [0.25, 0.5, 0.75]) expect(meanEncoded(halftone.cpu(flat(v), { size: 8, shape: 'square' }))).toBeCloseTo(v, 1);
    });

    it('ring dots keep the tone while they fit their cell (beyond ~70% ink the ring outgrows it and is clipped)', () => {
      for (const v of [0.4, 0.5, 0.75, 0.9]) expect(meanEncoded(halftone.cpu(flat(v), { size: 8, shape: 'ring' }))).toBeCloseTo(v, 1);
    });

    it('a square dot reaches the corners a round one of the same area does not', () => {
      // size 10, angle 0, tone 0.5: cell centre (5, 5); pixel (1, 1) is 3.5 px away on both axes
      const [round, square] = (['circle', 'square'] as const).map((shape) => halftone.cpu(grey, { size: 10, angle: 0, shape }));
      expect(enc(round!, 1, 1)).toBeGreaterThan(0.9); // outside the circle (distance 4.95 > 3.99)
      expect(enc(square!, 1, 1)).toBeLessThan(0.6); // inside the square (3.5 < 3.54)
    });

    it('a ring is hollow at its centre', () => {
      const ring = halftone.cpu(grey, { size: 10, angle: 0, shape: 'ring' });
      expect(enc(ring, 5, 5)).toBeGreaterThan(0.95); // the hole
      expect(enc(ring, 1, 5)).toBeLessThan(0.1); // the band
      expect(enc(halftone.cpu(grey, { size: 10, angle: 0 }), 5, 5)).toBeLessThan(0.1); // a round dot is solid
    });

    it('a hex grid offsets every other row by half a spacing and keeps the tone', () => {
      for (const v of [0.25, 0.5, 0.75]) expect(meanEncoded(halftone.cpu(flat(v), { size: 8, grid: 'hex' }))).toBeCloseTo(v, 1);
      // tiny dots (tone 0.9), size 12, angle 0: row 0 has centres at x = 6, 18, ...; row 1 (y ≈ 15.6) at x = 0, 12, ...
      const img = halftone.cpu(flat(0.9), { size: 12, angle: 0, grid: 'hex' });
      expect(enc(img, 6, 5)).toBeLessThan(0.7);
      expect(enc(img, 0, 5)).toBeGreaterThan(0.99);
      expect(enc(img, 12, 15)).toBeLessThan(0.7);
      expect(enc(img, 6, 15)).toBeGreaterThan(0.99);
    });

    it('the default stays round dots on a square grid', () => {
      expect(halftone.params.shape.default).toBe('circle');
      expect(halftone.params.grid.default).toBe('square');
    });
  });
});
