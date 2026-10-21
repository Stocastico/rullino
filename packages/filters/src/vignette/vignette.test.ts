import { createImage } from '@rullino/core';
import { describe, expect, it } from 'vitest';
import { at, imageOf } from '../test-utils';
import { vignette } from './index';

const flat = (w = 41, h = 21, v = 0.5) => imageOf(w, h, () => [v, v, v]);

describe('vignette', () => {
  it('is the identity at amount 0', () => {
    expect([...vignette.cpu(flat(), { amount: 0 }).data]).toEqual([...flat().data]);
  });

  it('leaves the centre alone and darkens the corners, to black at -1', () => {
    const out = vignette.cpu(flat(), { amount: -1, midpoint: 0.3, feather: 0.2 });
    expect(at(out, 20, 10)).toBeCloseTo(0.5, 6);
    expect(at(out, 0, 0)).toBeCloseTo(0, 6);
    expect(at(out, 40, 20)).toBeCloseTo(0, 6);
    const half = vignette.cpu(flat(), { amount: -0.5, midpoint: 0.3, feather: 0.2 });
    expect(at(half, 0, 0)).toBeCloseTo(0.25, 6);
  });

  it('brightens towards white with a positive amount', () => {
    const out = vignette.cpu(flat(), { amount: 1, midpoint: 0.3, feather: 0.2 });
    expect(at(out, 0, 0)).toBeCloseTo(1, 6);
    expect(at(out, 20, 10)).toBeCloseTo(0.5, 6);
  });

  it('falls off monotonically from the centre', () => {
    const out = vignette.cpu(flat(), { amount: -1, midpoint: 0, feather: 1 });
    for (let x = 21; x < 41; x++) expect(at(out, x, 10)).toBeLessThanOrEqual(at(out, x - 1, 10));
  });

  it('is symmetric', () => {
    const out = vignette.cpu(flat(), { amount: -0.7 });
    for (const [x, y] of [[3, 2], [10, 7], [0, 15]] as const) {
      expect(at(out, 40 - x, y)).toBeCloseTo(at(out, x, y), 6);
      expect(at(out, x, 20 - y)).toBeCloseTo(at(out, x, y), 6);
    }
  });

  it('follows the image shape at roundness 0 and is circular at 1', () => {
    // Middle of the left edge vs middle of the top edge of a wide image.
    const ellipse = vignette.cpu(flat(81, 21), { amount: -1, midpoint: 0, feather: 1, roundness: 0 });
    expect(at(ellipse, 0, 10)).toBeCloseTo(at(ellipse, 40, 0), 1);
    const circle = vignette.cpu(flat(81, 21), { amount: -1, midpoint: 0, feather: 1, roundness: 1 });
    expect(at(circle, 0, 10)).toBeLessThan(at(circle, 40, 0) - 0.1);
  });

  it('works on premultiplied colour and keeps alpha', () => {
    const src = createImage(3, 3, new Float32Array(36).fill(0.25).map((v, i) => (i % 4 === 3 ? 0.5 : v)));
    const out = vignette.cpu(src, { amount: 1, midpoint: 0, feather: 0.05 });
    expect(at(out, 0, 0, 3)).toBe(0.5);
    expect(at(out, 0, 0)).toBeCloseTo(0.5, 6); // white at alpha 0.5
    expect([...src.data].every((v, i) => v === (i % 4 === 3 ? 0.5 : 0.25))).toBe(true);
  });
});
