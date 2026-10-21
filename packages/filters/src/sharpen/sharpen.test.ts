import { describe, expect, it } from 'vitest';
import { at, imageOf } from '../test-utils';
import { sharpen } from './index';

const edge = imageOf(8, 3, (x) => (x < 4 ? [0.2, 0.2, 0.2] : [0.6, 0.6, 0.6]));

describe('sharpen', () => {
  it('is the identity at 0 and leaves flat areas alone', () => {
    expect(sharpen.cpu(edge, { amount: 0 }).data).toEqual(edge.data);
    const out = sharpen.cpu(edge, { amount: 1 });
    expect(at(out, 0, 1)).toBeCloseTo(0.2, 6);
    expect(at(out, 7, 1)).toBeCloseTo(0.6, 6);
  });

  it('adds overshoot on both sides of an edge, never below zero, alpha untouched', () => {
    const out = sharpen.cpu(edge, { amount: 1 });
    expect(at(out, 3, 1)).toBeLessThan(0.2);
    expect(at(out, 4, 1)).toBeGreaterThan(0.6);
    const hard = sharpen.cpu(imageOf(4, 1, (x) => (x < 2 ? [0, 0, 0] : [1, 1, 1])), { amount: 3 });
    expect(Math.min(...Array.from(hard.data))).toBeGreaterThanOrEqual(0);
    expect(at(out, 3, 1, 3)).toBe(1);
  });
});
