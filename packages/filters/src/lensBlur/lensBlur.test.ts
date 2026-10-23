import { createImage, type LinearImage } from '@rullino/core';
import { describe, expect, it } from 'vitest';
import { at, imageOf, sum } from '../test-utils';
import { lensBlur } from './index';

/** A grey depth map (alpha 1) from a function of (x, y): 1 = near, 0 = far. */
function depthOf(w: number, h: number, f: (x: number, y: number) => number): LinearImage {
  const img = createImage(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img.data.set([f(x, y), f(x, y), f(x, y), 1], (y * w + x) * 4);
  return img;
}
const W = 41;
const H = 21;
/** Left half bright, right half dark. */
const halves = imageOf(W, H, (x) => (x < 20 ? [0.9, 0.9, 0.9] : [0.1, 0.1, 0.1]));

describe('lensBlur', () => {
  it('does nothing without a depth map', () => {
    expect(lensBlur.cpu(halves, { radius: 8 })).toEqual(halves);
  });

  it('keeps everything at the focus depth sharp', () => {
    const out = lensBlur.cpu(halves, { depth: depthOf(W, H, () => 0.5), focus: 0.5, radius: 8 });
    out.data.forEach((v, i) => expect(v).toBeCloseTo(halves.data[i]!, 6));
  });

  it('blurs what is far from the focus depth and preserves the overall light', () => {
    const out = lensBlur.cpu(halves, { depth: depthOf(W, H, () => 0), focus: 1, range: 0, radius: 8 });
    // Across the edge the values are mixed, far from it they are untouched.
    expect(at(out, 19, 10)).toBeLessThan(0.8);
    expect(at(out, 20, 10)).toBeGreaterThan(0.2);
    expect(at(out, 2, 10)).toBeCloseTo(0.9, 3);
    expect(at(out, 38, 10)).toBeCloseTo(0.1, 3);
    // Uniform blur of a vertical edge: the total changes little (clamped edges only).
    expect(Math.abs(sum(out) - sum(halves)) / sum(halves)).toBeLessThan(0.03);
  });

  it('keeps an in-focus foreground sharp and does not let it bleed into a blurred background', () => {
    // Bright left half is near (in focus), dark right half is far (blurred).
    const depth = depthOf(W, H, (x) => (x < 20 ? 1 : 0));
    const out = lensBlur.cpu(halves, { depth, focus: 1, range: 0.1, radius: 8 });
    expect(at(out, 19, 10)).toBeCloseTo(0.9, 3); // foreground edge unchanged
    expect(at(out, 20, 10)).toBeLessThan(0.13); // background next to it stays dark: no bleeding
    // 2 px into the background only the one-pixel depth transition leaks; a uniform blur of the same radius mixes in much more.
    const uniform = lensBlur.cpu(halves, { depth: depthOf(W, H, () => 0), focus: 1, range: 0.1, radius: 8 });
    expect(at(out, 22, 10)).toBeLessThan(0.15);
    expect(at(uniform, 22, 10)).toBeGreaterThan(0.3);
    expect(at(out, 30, 10)).toBeCloseTo(0.1, 3);
  });

  it('a wider sharp range keeps more of the scene sharp', () => {
    const depth = depthOf(W, H, () => 0.6);
    const narrow = lensBlur.cpu(halves, { depth, focus: 0.5, range: 0, radius: 8 });
    const wide = lensBlur.cpu(halves, { depth, focus: 0.5, range: 0.2, radius: 8 });
    expect(Math.abs(at(narrow, 19, 10) - 0.9)).toBeGreaterThan(0.05);
    expect(at(wide, 19, 10)).toBeCloseTo(0.9, 6);
  });

  it('the blur grows with the radius', () => {
    const depth = depthOf(W, H, () => 0);
    const spread = (radius: number) => {
      const out = lensBlur.cpu(halves, { depth, focus: 1, range: 0, radius });
      return at(out, 14, 10) - 0.9; // how far the bright side has darkened 6 px from the edge
    };
    expect(spread(2)).toBeCloseTo(0, 6);
    expect(spread(12)).toBeLessThan(-0.01);
  });

  it('weights the blur by the depth map alpha (no depth where it is transparent)', () => {
    const depth = depthOf(W, H, () => 0);
    for (let i = 0; i < depth.data.length; i += 4) {
      depth.data[i + 3] = 0;
      depth.data[i] = 0;
    }
    const out = lensBlur.cpu(halves, { depth, focus: 1, range: 0, radius: 8 });
    expect(out).toEqual(halves);
  });

  it('keeps alpha as part of the blurred light and does not modify its input', () => {
    const src = createImage(W, H);
    for (let i = 0; i < W * H; i++) src.data.set(i % W < 20 ? [0.5, 0.5, 0.5, 0.5] : [0, 0, 0, 0], i * 4);
    const copy = new Float32Array(src.data);
    const out = lensBlur.cpu(src, { depth: depthOf(W, H, () => 0), focus: 1, range: 0, radius: 8 });
    expect(src.data).toEqual(copy);
    expect(at(out, 20, 10, 3)).toBeGreaterThan(0.05); // coverage spills over the edge
    expect(at(out, 20, 10, 3)).toBeLessThan(0.5);
  });
});
