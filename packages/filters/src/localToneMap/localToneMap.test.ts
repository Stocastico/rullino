import { createImage } from '@rullino/core';
import { describe, expect, it } from 'vitest';
import { at, imageOf } from '../test-utils';
import { localToneMap } from './index';

const MID = Math.log(0.18);
const run = (img: ReturnType<typeof imageOf>, p: Record<string, number>) => localToneMap.cpu(img, { strength: 0.5, detail: 1, sigma: 3, ...p } as never);

describe('localToneMap', () => {
  it('is the identity with no compression and unit detail, on any picture', () => {
    const img = imageOf(23, 17, (x, y) => [0.05 + x / 10, 0.01 + y / 20, 2 * ((x + y) % 5)]);
    const out = run(img, { strength: 0, detail: 1 });
    for (let i = 0; i < img.data.length; i++) expect(out.data[i]).toBeCloseTo(img.data[i]!, 4);
  });

  it('compresses a region towards mid grey in the log domain: L\' = 0.18^s · L^(1 − s) where the region is uniform', () => {
    const img = imageOf(41, 41, () => [2, 2, 2]);
    for (const s of [0.25, 0.5, 1]) {
      const out = run(img, { strength: s, sigma: 2 });
      expect(at(out, 20, 20)).toBeCloseTo(Math.exp(s * MID + (1 - s) * Math.log(2)), 5);
    }
  });

  it('pulls a dark and a bright region together far from their edge, and keeps the order', () => {
    const img = imageOf(61, 21, (x) => (x < 30 ? [0.02, 0.02, 0.02] : [4, 4, 4]));
    const out = run(img, { strength: 0.8, sigma: 3 });
    const dark = at(out, 5, 10);
    const bright = at(out, 55, 10);
    expect(bright).toBeGreaterThan(dark);
    expect(bright / dark).toBeLessThan((4 / 0.02) ** 0.4); // the ratio shrank to (1 − 0.8) of its log
    expect(dark).toBeGreaterThan(0.02); // shadows lifted
    expect(bright).toBeLessThan(4); // highlights lowered
  });

  it('detail multiplies local contrast: neighbours differ by the power `detail` of their ratio', () => {
    const img = imageOf(32, 32, (x, y) => (((x + y) & 1 ? [0.3, 0.3, 0.3] : [0.1, 0.1, 0.1])));
    const one = run(img, { strength: 0, detail: 1, sigma: 10 });
    const two = run(img, { strength: 0, detail: 2, sigma: 10 });
    const r1 = at(one, 16, 16) / at(one, 17, 16);
    const r2 = at(two, 16, 16) / at(two, 17, 16);
    expect(r2).toBeCloseTo(r1 * r1, 3);
    const flat = run(img, { strength: 0, detail: 0.5, sigma: 10 });
    expect(at(flat, 16, 16) / at(flat, 17, 16)).toBeCloseTo(Math.sqrt(r1), 3);
  });

  it('scales the colour channels together: hue and saturation as ratios are kept', () => {
    const img = imageOf(21, 21, (x) => [0.4 + x * 0.1, 0.2 + x * 0.05, 0.1]);
    const out = run(img, { strength: 0.7, detail: 1.5, sigma: 4 });
    for (const x of [3, 10, 17]) {
      expect(at(out, x, 10, 0) / at(out, x, 10, 1)).toBeCloseTo(at(img, x, 10, 0) / at(img, x, 10, 1), 4);
      expect(at(out, x, 10, 1) / at(out, x, 10, 2)).toBeCloseTo(at(img, x, 10, 1) / at(img, x, 10, 2), 4);
    }
  });

  it('keeps alpha, leaves black and transparent pixels alone, and stays finite on colours outside sRGB', () => {
    const img = createImage(3, 1, Float32Array.of(0, 0, 0, 1, 0.2, 0.1, 0.05, 0.5, -0.3, 0.8, 0.5, 1));
    const out = run(img, { strength: 1, detail: 2, sigma: 1 });
    expect(out.data[3]).toBe(1);
    expect(out.data[7]).toBe(0.5);
    expect(Array.from(out.data.slice(0, 3))).toEqual([0, 0, 0]);
    for (const v of out.data) expect(Number.isFinite(v)).toBe(true);
    expect(run(createImage(2, 1, new Float32Array(8)), { strength: 1 }).data.every((v) => v === 0)).toBe(true);
  });

  it('does not change its input', () => {
    const img = imageOf(9, 9, (x) => [x * 0.2, 0.3, 0.1]);
    const before = img.data.slice();
    run(img, { strength: 1, detail: 2 });
    expect(Array.from(img.data)).toEqual(Array.from(before));
  });
});
