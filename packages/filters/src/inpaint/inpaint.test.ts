import { createImage } from '@rullino/core';
import { describe, expect, it } from 'vitest';
import { at, imageOf } from '../test-utils';
import { inpaint } from './index';

const W = 31;
const H = 15;
/** A hard rectangular hole: x in [12, 18], y in [5, 9]. */
const hole = Float32Array.from({ length: W * H }, (_, i) => (i % W >= 12 && i % W <= 18 && Math.floor(i / W) >= 5 && Math.floor(i / W) <= 9 ? 1 : 0));
/** The image with garbage (an object to remove) inside the hole. */
const withObject = (f: (x: number) => number) => imageOf(W, H, (x, y) => (hole[y * W + x] ? [1, 0, 1] : [f(x), f(x), f(x)]));

describe('inpaint', () => {
  it('leaves pixels outside the mask untouched', () => {
    const src = withObject((x) => 0.1 + 0.02 * x);
    const out = inpaint.cpu(src, {}, hole);
    for (let i = 0; i < W * H; i++) if (!hole[i]) for (let c = 0; c < 4; c++) expect(out.data[i * 4 + c]).toBeCloseTo(src.data[i * 4 + c]!, 3);
  });

  it('fills a hole in a flat area with the surrounding colour', () => {
    const out = inpaint.cpu(withObject(() => 0.3), {}, hole);
    for (const [x, y] of [[12, 5], [15, 7], [18, 9]] as const) {
      expect(at(out, x, y, 0)).toBeCloseTo(0.3, 2);
      expect(at(out, x, y, 1)).toBeCloseTo(0.3, 2);
      expect(at(out, x, y, 3)).toBeCloseTo(1, 2);
    }
  });

  it('continues a linear ramp across the hole', () => {
    const ramp = (x: number) => 0.1 + 0.02 * x;
    const out = inpaint.cpu(withObject(ramp), { iterations: 400 }, hole);
    for (let x = 12; x <= 18; x++) expect(Math.abs(at(out, x, 7) - ramp(x))).toBeLessThan(0.01);
  });

  it('diffusion iterations improve on the initial estimate', () => {
    const ramp = (x: number) => 0.1 + 0.02 * x;
    const err = (iterations: number) => {
      const out = inpaint.cpu(withObject(ramp), { iterations, sigma: 8 }, hole);
      let e = 0;
      for (let x = 12; x <= 18; x++) e += Math.abs(at(out, x, 7) - ramp(x));
      return e;
    };
    expect(err(200)).toBeLessThan(err(0));
  });

  it('needs a mask', () => {
    expect(() => inpaint.cpu(createImage(2, 2))).toThrow(/needs a mask/);
  });
});
