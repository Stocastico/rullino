import { linearToSrgb, srgbToLinear } from '@rullino/core';
import { describe, expect, it } from 'vitest';
import { at, imageOf } from '../test-utils';
import { gradient } from './index';

const enc = (img: { width: number; data: Float32Array }, x: number, y: number) => linearToSrgb(at(img, x, y));
const lin = (v: number) => srgbToLinear(v);
// An encoded-luminance ramp of slope 0.1 per pixel along x, and the same along y.
const rampX = imageOf(9, 9, (x) => [lin(0.1 * x), lin(0.1 * x), lin(0.1 * x)]);
const rampY = imageOf(9, 9, (_, y) => [lin(0.1 * y), lin(0.1 * y), lin(0.1 * y)]);

describe('gradient', () => {
  it('every method measures the slope per pixel on a ramp (horizontal output on mid grey)', () => {
    for (const method of ['sobel', 'scharr', 'prewitt'] as const)
      expect(enc(gradient.cpu(rampX, { method, output: 'horizontal' }), 4, 4)).toBeCloseTo(0.5 + 0.1, 4);
  });

  it('horizontal ignores a vertical ramp and vertical ignores a horizontal one; signs follow the axes', () => {
    expect(enc(gradient.cpu(rampY, { output: 'horizontal' }), 4, 4)).toBeCloseTo(0.5, 5);
    expect(enc(gradient.cpu(rampX, { output: 'vertical' }), 4, 4)).toBeCloseTo(0.5, 5);
    expect(enc(gradient.cpu(rampY, { output: 'vertical' }), 4, 4)).toBeCloseTo(0.6, 4);
    const falling = imageOf(9, 9, (x) => [lin(1 - 0.1 * x), lin(1 - 0.1 * x), lin(1 - 0.1 * x)]);
    expect(enc(gradient.cpu(falling, { output: 'horizontal' }), 4, 4)).toBeCloseTo(0.4, 4);
  });

  it('magnitude combines both axes and is zero on flat areas', () => {
    const diag = imageOf(9, 9, (x, y) => [lin(0.05 * x + 0.05 * y), lin(0.05 * x + 0.05 * y), lin(0.05 * x + 0.05 * y)]);
    expect(enc(gradient.cpu(diag, { method: 'scharr' }), 4, 4)).toBeCloseTo(Math.hypot(0.05, 0.05), 4);
    expect(enc(gradient.cpu(imageOf(5, 5, () => [0.3, 0.3, 0.3]), {}), 2, 2)).toBeCloseTo(0, 6);
  });

  it('operators differ on a corner (their weights differ), strength scales, alpha is kept', () => {
    const corner = imageOf(7, 7, (x, y) => (x >= 3 && y >= 3 ? [1, 1, 1] : [0, 0, 0]));
    const m = (method: 'sobel' | 'scharr' | 'prewitt') => enc(gradient.cpu(corner, { method }), 3, 3);
    expect(new Set([m('sobel'), m('scharr'), m('prewitt')]).size).toBe(3);
    expect(enc(gradient.cpu(rampX, { output: 'horizontal', strength: 2 }), 4, 4)).toBeCloseTo(0.7, 4);
    const half = imageOf(5, 5, (x) => [0.1 * x, 0.1 * x, 0.1 * x]);
    for (let i = 3; i < half.data.length; i += 4) half.data[i] = 0.5;
    expect(at(gradient.cpu(half, {}), 2, 2, 3)).toBe(0.5);
  });

  it('clamps at the image edge, and transparent pixels count as black', () => {
    expect(enc(gradient.cpu(rampX, { output: 'horizontal' }), 0, 4)).toBeCloseTo(0.5 + 0.05, 4); // half the span: clamped neighbour
    const hole = imageOf(5, 5, () => [1, 1, 1]);
    hole.data.set([0, 0, 0, 0], (2 * 5 + 2) * 4);
    expect(enc(gradient.cpu(hole, { output: 'horizontal' }), 3, 2)).toBeGreaterThan(0.5); // 1 - 0 across the hole
  });
});
