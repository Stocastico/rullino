import { describe, expect, it } from 'vitest';
import { at, imageOf } from '../test-utils';
import { unsharpMask } from './index';

const edge = imageOf(24, 3, (x) => (x < 12 ? [0.2, 0.2, 0.2] : [0.6, 0.6, 0.6]));

describe('unsharpMask', () => {
  it('is the identity at amount 0 and on flat areas', () => {
    expect(Array.from(unsharpMask.cpu(edge, { amount: 0 }).data)).toEqual(Array.from(edge.data));
    const out = unsharpMask.cpu(edge, { amount: 2, sigma: 1 });
    expect(at(out, 0, 1)).toBeCloseTo(0.2, 6);
  });

  it('increases local contrast across an edge, wider with larger sigma', () => {
    const narrow = unsharpMask.cpu(edge, { amount: 1, sigma: 1 });
    const wide = unsharpMask.cpu(edge, { amount: 1, sigma: 3 });
    expect(at(narrow, 11, 1)).toBeLessThan(0.2);
    expect(at(narrow, 12, 1)).toBeGreaterThan(0.6);
    // Three pixels away the narrow mask has died out, the wide one has not.
    expect(at(narrow, 8, 1)).toBeCloseTo(0.2, 3);
    expect(at(wide, 8, 1)).toBeLessThan(0.199);
  });
});
