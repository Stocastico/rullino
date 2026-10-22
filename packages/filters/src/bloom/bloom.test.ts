import { describe, expect, it } from 'vitest';
import { at, imageOf, sum } from '../test-utils';
import { bloom } from './index';

describe('bloom', () => {
  it('leaves an image below the threshold untouched', () => {
    const img = imageOf(15, 15, (x, y) => [0.1 + 0.01 * x, 0.2, 0.05 * (y % 3)]);
    const out = bloom.cpu(img, { threshold: 0.8 });
    out.data.forEach((v, i) => expect(v).toBeCloseTo(img.data[i]!, 3));
  });

  it('a bright point glows into its neighbours, adding light in proportion to intensity', () => {
    const img = imageOf(31, 31, (x, y) => (x === 15 && y === 15 ? [4, 4, 4] : [0, 0, 0]));
    const out = bloom.cpu(img, { threshold: 0.5, sigma: 3, intensity: 1 });
    // 4 · exp(−½) / (2π · 9) ≈ 0.043 at 3 px with σ = 3.
    expect(at(out, 18, 15)).toBeCloseTo((4 * Math.exp(-0.5)) / (2 * Math.PI * 9), 2);
    expect(at(out, 18, 15)).toBeGreaterThan(at(out, 21, 15));
    // The blur keeps the bright part's energy: the image gains ~intensity × 4.
    expect(sum(out) - sum(img)).toBeCloseTo(4, 1);
    const half = bloom.cpu(img, { threshold: 0.5, sigma: 3, intensity: 0.5 });
    expect(sum(half) - sum(img)).toBeCloseTo(2, 1);
  });

  it('is the identity at intensity 0; sigma is in px', () => {
    const img = imageOf(9, 9, () => [2, 1, 0.5]);
    expect(bloom.cpu(img, { intensity: 0 }).data).toEqual(img.data);
    expect(bloom.params.sigma.unit).toBe('px');
  });
});
