import { describe, expect, it } from 'vitest';
import { at, imageOf } from '../test-utils';
import { gaussianBlur } from './index';

const impulse = imageOf(31, 31, (x, y) => (x === 15 && y === 15 ? [1, 1, 1] : [0, 0, 0]));

describe('gaussianBlur', () => {
  it('is the identity at sigma 0', () => {
    expect(gaussianBlur.cpu(impulse, { sigma: 0 }).data).toEqual(impulse.data);
  });

  it('spreads an impulse into a normalised, symmetric Gaussian', () => {
    const out = gaussianBlur.cpu(impulse, { sigma: 2 });
    let total = 0;
    for (let y = 0; y < 31; y++) for (let x = 0; x < 31; x++) total += at(out, x, y);
    expect(total).toBeCloseTo(1, 5);
    expect(at(out, 13, 15)).toBeCloseTo(at(out, 17, 15), 9);
    expect(at(out, 15, 13)).toBeCloseTo(at(out, 15, 17), 9);
    // Ratio between neighbouring samples on an axis follows exp(-x²/2σ²).
    expect(at(out, 16, 15) / at(out, 15, 15)).toBeCloseTo(Math.exp(-1 / 8), 5);
  });

  it('keeps a constant image constant (edges clamp, no darkening)', () => {
    const flat = imageOf(9, 7, () => [0.3, 0.3, 0.3]);
    const out = gaussianBlur.cpu(flat, { sigma: 5 });
    expect(Array.from(out.data).every((v, i) => Math.abs(v - flat.data[i]!) < 1e-6)).toBe(true);
  });

  it('measures sigma in pixels', () => {
    expect(gaussianBlur.params.sigma.unit).toBe('px');
  });
});
