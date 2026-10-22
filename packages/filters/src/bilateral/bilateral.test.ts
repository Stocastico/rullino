import { describe, expect, it } from 'vitest';
import { at, imageOf } from '../test-utils';
import { bilateral } from './index';

const N = 21;
const step = () => imageOf(N, N, (x) => (x < 10 ? [0.05, 0.05, 0.05] : [0.6, 0.6, 0.6]));
/** Flat grey with deterministic noise. */
const noisy = () => {
  let seed = 3;
  const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  return imageOf(N, N, () => {
    const v = 0.3 + (r() - 0.5) * 0.04;
    return [v, v, v];
  });
};
const variance = (img: { data: Float32Array }) => {
  const v = [...img.data].filter((_, i) => i % 4 === 0);
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length;
};

describe('bilateral', () => {
  it('leaves a flat image unchanged', () => {
    const flat = imageOf(9, 9, () => [0.4, 0.2, 0.1]);
    const out = bilateral.cpu(flat, {});
    for (let i = 0; i < out.data.length; i++) expect(out.data[i]).toBeCloseTo(flat.data[i]!, 6);
  });

  it('smooths noise in flat areas', () => {
    expect(variance(bilateral.cpu(noisy(), { sigmaSpace: 2, sigmaRange: 0.1 }))).toBeLessThan(variance(noisy()) / 4);
  });

  it('keeps edges much stronger than the range sigma', () => {
    const out = bilateral.cpu(step(), { sigmaSpace: 3, sigmaRange: 0.05 });
    expect(at(out, 9, 10)).toBeCloseTo(0.05, 3);
    expect(at(out, 10, 10)).toBeCloseTo(0.6, 3);
  });

  it('blurs across edges when the range sigma is large', () => {
    const out = bilateral.cpu(step(), { sigmaSpace: 3, sigmaRange: 2 });
    expect(at(out, 9, 10)).toBeGreaterThan(0.2);
    expect(at(out, 10, 10)).toBeLessThan(0.45);
  });

  it('does not mutate its input', () => {
    const src = step();
    const copy = src.data.slice();
    bilateral.cpu(src, {});
    expect(src.data).toEqual(copy);
  });
});
