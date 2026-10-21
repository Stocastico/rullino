import { describe, expect, it } from 'vitest';
import { px } from '../test-utils';
import { grayscale } from './index';

describe('grayscale', () => {
  it('uses Rec. 709 luminance by default', () => {
    const [r, g, b, a] = px(grayscale, [1, 0, 0, 1]);
    expect(r).toBeCloseTo(0.2126, 6);
    expect(g).toBeCloseTo(r, 6);
    expect(b).toBeCloseTo(r, 6);
    expect(a).toBe(1);
  });

  it('supports average and max', () => {
    expect(px(grayscale, [0.6, 0.3, 0, 1], { method: 'average' })[0]).toBeCloseTo(0.3, 6);
    expect(px(grayscale, [0.6, 0.3, 0, 1], { method: 'max' })[1]).toBeCloseTo(0.6, 6);
  });

  it('blends with the original by amount', () => {
    expect(px(grayscale, [1, 0, 0, 1], { amount: 0 })).toEqual([1, 0, 0, 1]);
    expect(px(grayscale, [1, 0, 0, 1], { amount: 0.5 })[0]).toBeCloseTo((1 + 0.2126) / 2, 6);
  });
});
