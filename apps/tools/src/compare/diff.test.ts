import { describe, expect, it } from 'vitest';
import { diffImages, MAP } from './diff';

const img = (w: number, h: number, f: (i: number) => [number, number, number, number]) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(f(i), i * 4);
  return { width: w, height: h, data };
};

describe('diffImages', () => {
  const a = img(4, 2, (i) => [i * 30, 100, 200, 255]);

  it('identical images agree, with no difference anywhere', () => {
    const d = diffImages(a, a, { levels: 0 });
    expect(d).toMatchObject({ agree: true, max: 0, mean: 0, over: 0, differing: 0 });
  });

  it('counts the pixels beyond the tolerance (any channel, alpha included) and finds the largest difference', () => {
    const b = img(4, 2, (i) => [i * 30 + (i === 1 ? 2 : 0), 100 + (i === 5 ? 9 : 0), 200, i === 6 ? 250 : 255]);
    const d = diffImages(a, b, { levels: 2 });
    expect(d.max).toBe(9);
    expect(d.at).toEqual({ x: 1, y: 1, channel: 1 });
    expect(d.differing).toBe(3);
    expect(d.over).toBe(2); // pixel 1 differs by 2: within
    expect(d.agree).toBe(false);
    expect(d.mean).toBeCloseTo((2 + 9 + 5) / (8 * 4), 10);
    expect(diffImages(a, b, { levels: 9 }).agree).toBe(true);
    expect(diffImages(a, b, { levels: 2, allowed: 0.25 }).agree).toBe(true); // 2 of 8 pixels allowed
    expect(diffImages(a, b, { levels: 2, allowed: 0.2 }).agree).toBe(false);
  });

  it('draws a map: the first image faded where equal, blue within the tolerance, red beyond', () => {
    const b = img(4, 2, (i) => [i * 30 + (i === 1 ? 2 : 0), 100 + (i === 5 ? 9 : 0), 200, 255]);
    const { map } = diffImages(a, b, { levels: 2 });
    const px = (i: number) => [...map.subarray(i * 4, i * 4 + 4)];
    expect(px(5)).toEqual(MAP.over);
    expect(px(1)[2]).toBeGreaterThan(px(1)[0]!); // within: blue
    expect(px(0)[0]).toBe(px(0)[2]); // equal: grey
    expect(px(0)[3]).toBe(255);
  });

  it('refuses images of two sizes, saying both', () => {
    expect(() => diffImages(a, img(3, 2, () => [0, 0, 0, 255]), { levels: 1 })).toThrow(/4×2 and 3×2/);
  });
});
