import { describe, expect, it } from 'vitest';
import { compareImages } from './compare';
import { createImage } from './image';

const img = (...v: number[]) => createImage(v.length / 4, 1, new Float32Array(v));

describe('compareImages', () => {
  it('passes identical images', () => {
    expect(compareImages(img(1, 2, 3, 1), img(1, 2, 3, 1), { abs: 0, rel: 0 }).pass).toBe(true);
  });

  it('applies abs + rel * |expected| per channel and reports the worst offender', () => {
    const expected = img(0, 0, 0, 1, 10, 10, 10, 1);
    const ok = compareImages(img(0.01, 0, 0, 1, 10.5, 10, 10, 1), expected, { abs: 0.01, rel: 0.05 });
    expect(ok.pass).toBe(true);

    const bad = compareImages(img(0, 0, 0, 1, 10, 10, 11, 1), expected, { abs: 0.01, rel: 0.05 });
    expect(bad.pass).toBe(false);
    expect(bad.worst).toEqual({ x: 1, y: 0, channel: 2, actual: 11, expected: 10 });
  });

  it('fails on NaN', () => {
    expect(compareImages(img(NaN, 0, 0, 1), img(0, 0, 0, 1), { abs: 1, rel: 1 }).pass).toBe(false);
  });

  it('rejects mismatched sizes', () => {
    expect(() => compareImages(img(0, 0, 0, 0), img(0, 0, 0, 0, 0, 0, 0, 0), { abs: 0, rel: 0 })).toThrow();
  });

  it('allows a declared fraction of outlier channels', () => {
    const expected = img(0, 0, 0, 1, 0, 0, 0, 1);
    const actual = img(1, 0, 0, 1, 0, 0, 0, 1); // 1 of 8 channels off
    expect(compareImages(actual, expected, { abs: 0, rel: 0, outliers: 0.125 }).pass).toBe(true);
    const res = compareImages(actual, expected, { abs: 0, rel: 0, outliers: 0.1 });
    expect(res.pass).toBe(false);
    expect(res.outliers).toBe(1);
    expect(compareImages(img(NaN, 0, 0, 1), img(0, 0, 0, 1), { abs: 0, rel: 0, outliers: 1 }).pass).toBe(false); // never NaN
  });
});

