import { describe, expect, it } from 'vitest';
import { px } from '../test-utils';
import { gamma } from './index';

describe('gamma', () => {
  it('is the identity at 1', () => {
    expect(px(gamma, [0.25, 0.5, 0.125, 1])).toEqual([0.25, 0.5, 0.125, 1]);
  });

  it('raises each straight linear channel to 1/gamma', () => {
    const [r, g] = px(gamma, [0.25, 0.0625, 0, 1], { gamma: 2 });
    expect(r).toBeCloseTo(0.5, 6);
    expect(g).toBeCloseTo(0.25, 6);
  });

  it('applies to straight colour under partial alpha', () => {
    const [r, , , a] = px(gamma, [0.125, 0, 0, 0.5], { gamma: 2 });
    expect(a).toBe(0.5);
    expect(r).toBeCloseTo(0.5 * 0.5, 6); // straight 0.25 -> 0.5, re-premultiplied
  });
});
