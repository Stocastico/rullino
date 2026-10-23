import { linearToSrgb, srgbToLinear } from '@rullino/core';
import { describe, expect, it } from 'vitest';
import { at, imageOf } from '../test-utils';
import { laplacian } from './index';

const enc = (img: { width: number; data: Float32Array }, x: number, y: number) => linearToSrgb(at(img, x, y));
const lin = (v: number) => srgbToLinear(v);
const dot = imageOf(7, 7, (x, y) => (x === 3 && y === 3 ? [lin(0.1), lin(0.1), lin(0.1)] : [0, 0, 0]));

describe('laplacian', () => {
  it('is zero on flat areas and on a linear ramp (signed output = mid grey)', () => {
    expect(enc(laplacian.cpu(imageOf(5, 5, () => [lin(0.3), lin(0.3), lin(0.3)]), {}), 2, 2)).toBeCloseTo(0.5, 5);
    const ramp = imageOf(9, 9, (x) => [lin(0.1 * x), lin(0.1 * x), lin(0.1 * x)]);
    expect(enc(laplacian.cpu(ramp, { connectivity: 'eight' }), 4, 4)).toBeCloseTo(0.5, 4);
  });

  it('a bright dot gives -4v at the dot and +v (four) or +v/2 (eight) at its neighbours; both are scaled alike', () => {
    const four = laplacian.cpu(dot, { connectivity: 'four' });
    const eight = laplacian.cpu(dot, { connectivity: 'eight' });
    expect(enc(four, 3, 3)).toBeCloseTo(0.5 - 0.4, 4);
    expect(enc(eight, 3, 3)).toBeCloseTo(0.5 - 0.4, 4);
    expect(enc(four, 4, 3)).toBeCloseTo(0.6, 4);
    expect(enc(four, 4, 4)).toBeCloseTo(0.5, 5); // diagonal: not a neighbour
    expect(enc(eight, 4, 4)).toBeCloseTo(0.55, 4);
  });

  it('magnitude output is the absolute value, strength scales, alpha is kept', () => {
    const s = laplacian.cpu(dot, { output: 'signed' });
    const m = laplacian.cpu(dot, { output: 'magnitude' });
    expect(enc(m, 3, 3)).toBeCloseTo(0.4, 4);
    expect(enc(s, 3, 3)).toBeCloseTo(0.1, 4);
    expect(enc(laplacian.cpu(dot, { output: 'magnitude', strength: 0.5 }), 3, 3)).toBeCloseTo(0.2, 4);
    const half = imageOf(5, 5, (x) => [0.1 * x, 0.1 * x, 0.1 * x]);
    for (let i = 3; i < half.data.length; i += 4) half.data[i] = 0.5;
    expect(at(laplacian.cpu(half, {}), 2, 2, 3)).toBe(0.5);
  });
});
