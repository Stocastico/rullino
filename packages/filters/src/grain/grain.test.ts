import { createImage, linearToSrgb, srgbToLinear } from '@rullino/core';
import { describe, expect, it } from 'vitest';
import { imageOf } from '../test-utils';
import { grain } from './index';

const flat = (e: number, n = 64) => imageOf(n, n, () => [srgbToLinear(e), srgbToLinear(e), srgbToLinear(e)]);

/** Red channel, sRGB-encoded. */
const encoded = (img: { data: Float32Array }) => Array.from({ length: img.data.length / 4 }, (_, i) => linearToSrgb(img.data[i * 4]!));
const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
const std = (v: number[]) => Math.sqrt(mean(v.map((x) => (x - mean(v)) ** 2)));
/** Correlation between horizontally adjacent pixels of an n x n image. */
function neighbourCorrelation(v: number[], n: number) {
  const a: number[] = [];
  const b: number[] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x + 1 < n; x++) a.push(v[y * n + x]!), b.push(v[y * n + x + 1]!);
  const [ma, mb] = [mean(a), mean(b)];
  return mean(a.map((x, i) => (x - ma) * (b[i]! - mb))) / (std(a) * std(b));
}

describe('grain', () => {
  it('is the identity at amount 0', () => {
    const src = flat(0.5, 8);
    expect([...grain.cpu(src, { amount: 0 }).data]).toEqual([...src.data]);
  });

  it('adds zero-mean monochrome noise', () => {
    const out = grain.cpu(flat(0.5), { amount: 0.5 });
    const e = encoded(out);
    expect(std(e)).toBeGreaterThan(0.02);
    expect(Math.abs(mean(e) - 0.5)).toBeLessThan(0.01);
    for (let i = 0; i < out.data.length; i += 4) expect(out.data[i + 1]).toBe(out.data[i]); // same noise on every channel
  });

  it('is strongest in the midtones (film-like), weaker in deep shadows and highlights', () => {
    const s = (e: number) => std(encoded(grain.cpu(flat(e), { amount: 0.5 })));
    expect(s(0.5)).toBeGreaterThan(1.5 * s(0.05));
    expect(s(0.5)).toBeGreaterThan(1.5 * s(0.95));
  });

  it('is deterministic per seed', () => {
    const a = grain.cpu(flat(0.5, 16), { seed: 3 }).data;
    expect([...grain.cpu(flat(0.5, 16), { seed: 3 }).data]).toEqual([...a]);
    expect([...grain.cpu(flat(0.5, 16), { seed: 4 }).data]).not.toEqual([...a]);
  });

  it('gets coarser with size', () => {
    const c = (size: number) => neighbourCorrelation(encoded(grain.cpu(flat(0.5), { amount: 0.5, size })), 64);
    expect(Math.abs(c(1))).toBeLessThan(0.2);
    expect(c(4)).toBeGreaterThan(0.6);
  });

  it('keeps alpha, leaves transparent pixels at zero and never goes negative', () => {
    const src = createImage(2, 1, new Float32Array([0.002, 0.002, 0.002, 0.5, 0, 0, 0, 0]));
    const out = grain.cpu(src, { amount: 1 });
    expect(out.data[3]).toBe(0.5);
    expect([...out.data.slice(4)]).toEqual([0, 0, 0, 0]);
    for (const v of grain.cpu(flat(0.01), { amount: 1 }).data) expect(v).toBeGreaterThanOrEqual(0);
  });
});
