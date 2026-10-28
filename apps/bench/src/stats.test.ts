import { describe, expect, it } from 'vitest';
import { meanAbsDiff, summarise } from './stats';

describe('summarise', () => {
  it('gives median, min, max and the count, whatever the order', () => {
    expect(summarise([5, 1, 3])).toEqual({ median: 3, min: 1, max: 5, runs: 3 });
    expect(summarise([4, 1, 3, 2])).toEqual({ median: 2.5, min: 1, max: 4, runs: 4 });
  });
  it('rejects an empty sample', () => {
    expect(() => summarise([])).toThrow();
  });
});

describe('meanAbsDiff', () => {
  it('is the mean absolute difference of the colour channels in 8-bit units, alpha ignored', () => {
    const a = new Uint8Array([10, 20, 30, 255, 0, 0, 0, 0]);
    const b = new Uint8Array([12, 20, 27, 0, 0, 0, 6, 255]);
    expect(meanAbsDiff(a, b)).toBeCloseTo((2 + 0 + 3 + 0 + 0 + 6) / 6, 10);
  });
  it('needs images of the same size', () => {
    expect(() => meanAbsDiff(new Uint8Array(8), new Uint8Array(4))).toThrow();
  });
});
