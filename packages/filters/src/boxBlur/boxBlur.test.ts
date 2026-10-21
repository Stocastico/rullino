import { describe, expect, it } from 'vitest';
import { at, imageOf } from '../test-utils';
import { boxBlur } from './index';

describe('boxBlur', () => {
  it('turns an impulse into a flat square', () => {
    const impulse = imageOf(11, 11, (x, y) => (x === 5 && y === 5 ? [1, 1, 1] : [0, 0, 0]));
    const out = boxBlur.cpu(impulse, { radius: 2 });
    expect(at(out, 3, 3)).toBeCloseTo(1 / 25, 7);
    expect(at(out, 7, 7)).toBeCloseTo(1 / 25, 7);
    expect(at(out, 2, 5)).toBe(0);
  });

  it('is the identity at radius 0 and uses pixel units', () => {
    const img = imageOf(4, 3, (x, y) => [x / 4, y / 3, 0.5]);
    expect(boxBlur.cpu(img, { radius: 0 }).data).toEqual(img.data);
    expect(boxBlur.params.radius.unit).toBe('px');
  });
});
