import { describe, expect, it } from 'vitest';
import { createImage } from './image';
import { downscaleCpu, fitWithin } from './resize';

const img = (w: number, h: number, px: number[][]) => createImage(w, h, new Float32Array(px.flat()));

describe('downscaleCpu (area average)', () => {
  it('averages whole blocks', () => {
    const out = downscaleCpu(img(2, 2, [[1, 0, 0, 1], [0, 1, 0, 1], [0, 0, 1, 1], [1, 1, 1, 1]]), 1, 1);
    expect(Array.from(out.data)).toEqual([0.5, 0.5, 0.5, 1]);
  });

  it('weights partially covered pixels by coverage', () => {
    // 3 -> 2: the first output pixel covers [0, 1.5): a fully and b half.
    const out = downscaleCpu(img(3, 1, [[0.3, 0, 0, 1], [0.6, 0, 0, 1], [0.9, 0, 0, 1]]), 2, 1);
    expect(out.data[0]).toBeCloseTo((0.3 + 0.6 * 0.5) / 1.5, 6);
    expect(out.data[4]).toBeCloseTo((0.6 * 0.5 + 0.9) / 1.5, 6);
  });

  it('averages premultiplied colour, so transparent pixels do not darken edges', () => {
    const out = downscaleCpu(img(2, 1, [[0.8, 0.8, 0.8, 1], [0, 0, 0, 0]]), 1, 1);
    const [r, , , a] = out.data;
    expect(a).toBeCloseTo(0.5, 6);
    expect(r! / a!).toBeCloseTo(0.8, 6); // straight colour unchanged
  });

  it('keeps a constant image constant and rejects upscaling', () => {
    const c = createImage(7, 5, new Float32Array(7 * 5 * 4).fill(0.25));
    expect(Array.from(downscaleCpu(c, 3, 2).data).every((v) => Math.abs(v - 0.25) < 1e-6)).toBe(true);
    expect(() => downscaleCpu(c, 8, 5)).toThrow(RangeError);
  });
});

describe('fitWithin', () => {
  it('keeps the aspect ratio and never upscales', () => {
    expect(fitWithin(4000, 3000, 1000)).toEqual([1000, 750]);
    expect(fitWithin(300, 200, 1000)).toEqual([300, 200]);
    expect(fitWithin(3000, 4001, 1000)).toEqual([750, 1000]);
    expect(fitWithin(5000, 1, 100)).toEqual([100, 1]);
  });
});
