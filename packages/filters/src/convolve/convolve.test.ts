import { describe, expect, it } from 'vitest';
import { at, imageOf } from '../test-utils';
import { convolve } from './index';

const img = imageOf(6, 5, (x, y) => [x / 6, y / 5, 0.5]);
const k5 = (k3: number[]) => {
  const out = new Array(25).fill(0);
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) out[(j + 1) * 5 + i + 1] = k3[j * 3 + i];
  return out;
};

describe('convolve', () => {
  it('defaults to the identity kernel', () => {
    expect(Array.from(convolve.cpu(img).data)).toEqual(Array.from(img.data));
  });

  it('applies a kernel with clamp-to-edge, keeping alpha', () => {
    // Horizontal difference: right neighbour minus left neighbour.
    const out = convolve.cpu(img, { kernel: k5([0, 0, 0, -1, 0, 1, 0, 0, 0]), normalize: false });
    expect(at(out, 2, 2)).toBeCloseTo(2 / 6, 6);
    expect(at(out, 0, 2)).toBeCloseTo(1 / 6, 6); // left neighbour clamps to itself
    expect(at(out, 2, 2, 3)).toBe(1);
  });

  it('normalises by the kernel sum when asked', () => {
    const ones = k5([1, 1, 1, 1, 1, 1, 1, 1, 1]);
    const flat = imageOf(5, 5, () => [0.4, 0.4, 0.4]);
    expect(at(convolve.cpu(flat, { kernel: ones, normalize: true }), 2, 2)).toBeCloseTo(0.4, 6);
    expect(at(convolve.cpu(flat, { kernel: ones, normalize: false }), 2, 2)).toBeCloseTo(3.6, 5);
  });

  it('adds a bias and clamps negative light to zero', () => {
    const out = convolve.cpu(img, { kernel: k5([0, 0, 0, 0, -1, 0, 0, 0, 0]), normalize: false, bias: 0.25 });
    expect(at(out, 0, 0, 2)).toBe(0); // -0.5 + 0.25 < 0
    expect(at(out, 0, 0, 0)).toBeCloseTo(0.25, 6); // -0 + 0.25
  });
});
