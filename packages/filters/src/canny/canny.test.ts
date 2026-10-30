import { createImage, srgbToLinear } from '@rullino/core';
import { describe, expect, it } from 'vitest';
import { at, imageOf } from '../test-utils';
import { canny } from './index';

const enc = (v: number): [number, number, number] => {
  const l = srgbToLinear(v);
  return [l, l, l];
};
const edgesInRow = (img: ReturnType<typeof createImage>, y: number) =>
  Array.from({ length: img.width }, (_, x) => x).filter((x) => at(img, x, y) > 0.5);

const params = { sigma: 1, low: 0.08, high: 0.3, iterations: 64 };

describe('canny', () => {
  it('finds nothing in a flat image', () => {
    const out = canny.cpu(imageOf(16, 12, () => enc(0.4)), params);
    expect(Math.max(...Array.from(out.data).filter((_, i) => i % 4 === 0))).toBe(0);
  });

  it('turns a step into a one-pixel-wide line at the step', () => {
    const out = canny.cpu(imageOf(40, 20, (x) => enc(x < 20 ? 0 : 1)), params);
    for (const y of [3, 10, 16]) {
      const xs = edgesInRow(out, y);
      expect(xs).toHaveLength(1);
      expect([19, 20]).toContain(xs[0]);
    }
  });

  it('keeps weak edges only when connected to strong ones (hysteresis)', () => {
    // One vertical edge whose contrast fades from 1 (strong) at the top to 0.25 (weak) at the
    // bottom. The fade is gradual so it creates no competing horizontal edge (a T-junction would
    // break the chain under non-maximum suppression, as in any Canny).
    const img = imageOf(40, 30, (x, y) => enc(x < 20 ? 0.75 * Math.min(1, Math.max(0, (y - 5) / 20)) : 1));
    const kept = canny.cpu(img, params);
    const noHyst = canny.cpu(img, { ...params, iterations: 0 });
    expect(edgesInRow(kept, 25)).toHaveLength(1);
    expect(edgesInRow(noHyst, 25)).toHaveLength(0);
    expect(edgesInRow(noHyst, 5)).toHaveLength(1); // strong part needs no propagation

    // The same weak step on its own is dropped entirely.
    const weakOnly = canny.cpu(imageOf(40, 30, (x) => enc(x < 20 ? 0 : 0.25)), params);
    expect(edgesInRow(weakOnly, 25)).toHaveLength(0);
  });

  it('outputs white edges on black and keeps alpha (premultiplied)', () => {
    const img = imageOf(40, 20, (x) => enc(x < 20 ? 0 : 1));
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = 0.5;
    for (let i = 0; i < img.data.length; i += 4) for (let c = 0; c < 3; c++) img.data[i + c]! *= 0.5;
    const out = canny.cpu(img, params);
    const x = edgesInRow(createImage(out.width, out.height, out.data.map((v, i) => (i % 4 === 0 ? v * 2 : v))), 10)[0]!;
    expect([at(out, x, 10, 0), at(out, x, 10, 3)]).toEqual([0.5, 0.5]);
    expect(at(out, 2, 10, 0)).toBe(0);
  });

  it('measures sigma in pixels', () => {
    expect(canny.params.sigma.unit).toBe('px');
  });

  it('propagates exactly one pixel per hysteresis iteration', () => {
    // A vertical edge whose contrast fades (gradually, no T-junction) from strong to a long weak tail.
    const img = imageOf(20, 80, (x, y) => enc(x < 10 ? 0.75 * Math.min(1, Math.max(0, (y - 5) / 20)) : 1));
    const strongRows = (iterations: number) => {
      const out = canny.cpu(img, { ...params, iterations });
      return Array.from({ length: 80 }, (_, y) => y).filter((y) => edgesInRow(out, y).length > 0).length;
    };
    const r0 = strongRows(0);
    expect(strongRows(8) - r0).toBe(8);
    expect(strongRows(16) - r0).toBe(16);
  });
});


// The fast path must follow the reference round by round, not only once hysteresis has converged:
// long weak edges (vertical, horizontal and a diagonal chain that only an 8-connected rule follows)
// grow out of short strong segments. Contrast fades gradually: a hard switch would make a
// T-junction, which non-maximum suppression breaks. Exact, no outliers.
describe('canny fast path, hysteresis round by round', () => {
  const fade = (t: number) => 0.75 * Math.min(1, Math.max(0, (t - 5) / 20));
  const raw = imageOf(200, 150, (x, y) => {
    if (y >= 90) return enc(x - (y - 90) < 40 ? fade(y - 90) : 1);
    if (x < 100) return enc(x < 37 ? fade(y) : 1);
    return enc(y < 61 ? fade(x - 100) : 1);
  });
  const img = createImage(raw.width, raw.height, Float32Array.from(raw.data, (v) => Math.fround(v)));
  it.each([0, 1, 2, 7, 20, 64])('equals the reference after %i iterations', (iterations) => {
    const p = { sigma: 1, low: 0.08, high: 0.3, iterations };
    const want = canny.cpu(img, p);
    const got = canny.fast!(img, p);
    let differing = 0;
    for (let i = 0; i < want.data.length; i++) if (want.data[i] !== got.data[i]) differing++;
    expect(differing).toBe(0);
  });
  it('really propagates (the image is not trivial)', () => {
    const count = (n: number) => Array.from(canny.fast!(img, { sigma: 1, low: 0.08, high: 0.3, iterations: n }).data).filter((v, i) => i % 4 === 0 && v > 0.5).length;
    expect(count(1)).toBeGreaterThan(count(0));
    expect(count(20)).toBeGreaterThan(count(1));
  });
});
